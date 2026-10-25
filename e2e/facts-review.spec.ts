import type { Page } from '@playwright/test';
import { test, expect, connect } from './fixtures';

async function selectWithMouse(page: Page, phrase: string) {
  const box = await page.getByRole('textbox', { name: 'Original draft' }).evaluate((root, phrase) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const text = walker.currentNode.textContent ?? '', at = text.indexOf(phrase);
      if (at < 0) continue;
      const range = document.createRange(); range.setStart(walker.currentNode, at); range.setEnd(walker.currentNode, at + phrase.length);
      const rect = range.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    }
    throw new Error('Selection phrase was not rendered');
  }, phrase);
  await page.mouse.move(box.x + 1, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByRole('button', { name: 'Lock as fact', exact: true })).toBeVisible();
}

for (const preset of ['markdown', 'email', 'light']) {
  test(`mouse selection locks a fact in ${preset} and keeps it out of model requests`, async ({ page, modelServer }, info) => {
    await page.goto('/'); await connect(page, modelServer.url);
    const text = 'The release readiness review must keep its scope.\n\nPlease review the plan before sharing it.\n';
    await page.locator('input[type=file]').setInputFiles({ name: preset === 'markdown' ? 'draft.md' : 'draft.txt', mimeType: 'text/plain', buffer: Buffer.from(text) });
    await expect(page.getByRole('textbox', { name: 'Original draft' })).toContainText('release readiness');
    await page.getByRole('combobox', { name: 'Editing preset' }).selectOption(preset);
    await selectWithMouse(page, 'release readiness');
    if (preset === 'markdown') await page.screenshot({ path: info.outputPath('select-fact-light.png'), animations: 'disabled' });
    await page.getByRole('button', { name: 'Lock as fact', exact: true }).click();
    await expect(page.locator('.draft-panel .locked[title*="Fact"]')).toHaveText('release readiness');
    await expect(page.getByRole('button', { name: 'Lock as fact', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Edit draft' }).click();
    await expect(page.getByText('Edit complete. Every lock checked.')).toBeVisible();
    for (const request of modelServer.requests) expect(request.messages[1].content).not.toContain('release readiness');
    await expect(page.getByRole('textbox', { name: 'Edited result' })).toContainText('release readiness');
  });
}

test('heading wording can change while its Markdown prefix stays locked', async ({ page, modelServer }, info) => {
  await page.goto('/'); await connect(page, modelServer.url);
  await page.getByRole('button', { name: 'Try a sample' }).click();
  await expect(page.locator('.draft-panel .locked').filter({ hasText: '# A closer look' })).toHaveCount(0);
  await expect(page.locator('.draft-panel .locked').first()).toHaveText('# ');
  await page.getByRole('button', { name: 'Edit draft' }).click();
  await expect(page.getByText('Edit complete. Every lock checked.')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Edited result' })).toContainText('# Connection limits, explained');
  expect(modelServer.requests.some(request => request.messages[1].content.includes('A closer look at connection limits'))).toBe(true);
  const logo = page.locator('.brand-logo rect');
  await expect(logo).toHaveCSS('fill', 'rgb(165, 82, 49)');
  await expect(page.getByRole('button', { name: 'Edit draft' })).toHaveCSS('background-color', 'rgb(165, 82, 49)');
  await page.screenshot({ path: info.outputPath('brand-and-headings-light.png'), fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Toggle theme' }).click();
  await expect(logo).toHaveCSS('fill', 'rgb(237, 172, 134)');
  await expect(page.getByRole('button', { name: 'Edit draft' })).toHaveCSS('background-color', 'rgb(237, 172, 134)');
  await page.screenshot({ path: info.outputPath('brand-and-headings-dark.png'), fullPage: true, animations: 'disabled' });
});

test('change arrows highlight the first change and work repeatedly', async ({ page, modelServer }) => {
  await page.goto('/'); await connect(page, modelServer.url);
  const text = 'A concrete trace explains the connection.\n';
  await page.locator('input[type=file]').setInputFiles({ name: 'change.txt', mimeType: 'text/plain', buffer: Buffer.from(text) });
  await expect(page.getByRole('textbox', { name: 'Original draft' })).toContainText('A concrete trace');
  await page.getByRole('button', { name: 'Edit draft' }).click();
  await expect(page.getByText('Edit complete. Every lock checked.')).toBeVisible();
  await page.getByRole('button', { name: 'Next change' }).click();
  await expect(page.locator('.draft-panel .review-focus')).toHaveText('concrete');
  await page.getByRole('button', { name: 'Next change' }).click();
  await expect(page.locator('.draft-panel .review-focus')).toBeInViewport();
  await page.getByRole('button', { name: 'Previous change' }).click();
  await expect(page.locator('.draft-panel .review-focus')).toHaveText('concrete');
});

for (const width of [1440, 390]) {
  test(`retained review locates and highlights the exact output passage at ${width}px`, async ({ page, modelServer }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/'); await connect(page, modelServer.url);
    const text = '# A closer look at connection limits\n\n' + 'A concrete trace explains an important connection detail. '.repeat(42) + '\n\nMUST_RETAIN: The exact allocation limit is 42 ports for this client.\n';
    await page.locator('input[type=file]').setInputFiles({ name: 'retained.md', mimeType: 'text/markdown', buffer: Buffer.from(text) });
    await expect(page.getByRole('textbox', { name: 'Original draft' })).toContainText('A closer look');
    await page.getByRole('button', { name: 'Edit draft' }).click();
    await expect(page.getByText('Edit complete. Review retained passages in Edited.')).toBeVisible({ timeout: 12000 });
    const review = page.getByRole('complementary', { name: 'Retained passages' });
    await expect(page.locator('.result-panel').getByRole('complementary')).toBeVisible();
    await expect(review).toContainText('Unexpected HTML was added.');
    await expect(page.locator('.issue-list')).toHaveCount(0);
    const locate = review.getByRole('button', { name: 'Show retained passage 1' });
    await locate.click();
    await expect(page.locator('.result-panel .review-focus')).toContainText('MUST_RETAIN');
    await expect(page.locator('.result-panel .review-focus')).toBeInViewport();
    await page.screenshot({ path: info.outputPath(`retained-located-light-${width}.png`), fullPage: true, animations: 'disabled' });
    await page.locator('.result-panel .cm-scroller').evaluate(el => { el.scrollTop = 0; });
    await locate.click();
    await expect(page.locator('.result-panel .review-focus')).toBeInViewport();
    await page.getByRole('button', { name: 'Read', exact: true }).click();
    await locate.click();
    await expect(page.getByRole('textbox', { name: 'Edited result' })).toBeVisible();
    await expect(page.locator('.result-panel .review-focus')).toBeInViewport();
    await page.getByRole('button', { name: 'Toggle theme' }).click();
    await page.screenshot({ path: info.outputPath(`retained-located-dark-${width}.png`), fullPage: true, animations: 'disabled' });
  });
}
