import { readFile } from 'node:fs/promises';
import { test, expect, connect, openRetained } from './fixtures';

async function contrast(page: import('@playwright/test').Page, selector: string) {
  return page.locator(selector).first().evaluate(el => {
    const rgb = (color: string) => (color.match(/[\d.]+/g) ?? []).map(Number);
    const fg = rgb(getComputedStyle(el).color);
    let parent: Element | null = el, bg = [255, 255, 255];
    while (parent) {
      const color = rgb(getComputedStyle(parent).backgroundColor);
      if (color.length === 3 || color[3] === 1) { bg = color; break; }
      parent = parent.parentElement;
    }
    const luminance = (color: number[]) => color.slice(0, 3).map(n => n / 255).map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4).reduce((n, v, i) => n + v * [.2126, .7152, .0722][i], 0);
    const a = luminance(fg), b = luminance(bg);
    return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
  });
}

test('desktop: connection, real streaming, diff, previews, and both themes', async ({ page, modelServer }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await connect(page, modelServer.url);
  await page.getByRole('button', { name: 'Try a sample' }).click();
  const source = page.getByRole('textbox', { name: 'Original draft' });
  await expect(source).toBeVisible();
  const typography = await source.evaluate(el => { const s = getComputedStyle(el); return { padding: s.paddingTop, font: s.fontFamily, line: s.lineHeight }; });
  expect(parseFloat(typography.padding)).toBeGreaterThanOrEqual(20);
  expect(typography.font).not.toMatch(/^monospace/);
  await page.getByRole('button', { name: 'Edit draft' }).click();
  await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export' })).toBeDisabled();
  await expect(page.getByText('Edit complete. Every lock checked.')).toBeVisible();
  await expect(page.locator('.removed').first()).toBeVisible();
  await expect(page.locator('.added').first()).toBeVisible();
  for (const selector of ['.footer-meta', '.removed', '.added', '.et-link']) expect(await contrast(page, selector), selector).toBeGreaterThanOrEqual(4.5);
  expect(errors).toEqual([]);
  await page.screenshot({ path: info.outputPath('desktop-light.png'), fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Toggle theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('.draft-panel .cm-editor')).toHaveCSS('background-color', 'rgb(27, 30, 37)');
  for (const selector of ['.footer-meta', '.removed', '.added', '.et-link']) expect(await contrast(page, selector), selector).toBeGreaterThanOrEqual(4.5);
  await page.screenshot({ path: info.outputPath('desktop-dark.png'), fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'A closer look at connection limits' })).toBeVisible();
  await page.getByRole('button', { name: 'Read', exact: true }).click();
  await expect(page.getByLabel('Markdown preview')).toHaveCount(2);
  await page.screenshot({ path: info.outputPath('desktop-dark-preview.png'), fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Instructions' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.screenshot({ path: info.outputPath('instructions-dark.png'), animations: 'disabled' });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

for (const width of [320, 390, 768]) {
  test(`responsive workspace at ${width}px`, async ({ page, modelServer }, info) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    await connect(page, modelServer.url);
    await page.getByRole('button', { name: 'Try a sample' }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width < 700) {
      await expect(page.locator('.draft-panel')).toBeVisible();
      await expect(page.locator('.result-panel')).not.toBeVisible();
      await page.getByRole('group', { name: 'Editor panel' }).getByRole('button', { name: 'Edited' }).click();
      await expect(page.locator('.result-panel')).toBeVisible();
      await expect(page.locator('.draft-panel')).not.toBeVisible();
    }
    await page.getByRole('button', { name: 'Edit draft' }).click();
    await expect(page.getByText('Edit complete. Every lock checked.')).toBeVisible();
    await expect(page.locator('.added').first()).toBeVisible();
    const panel = await page.locator('.result-panel').boundingBox();
    const bar = await page.locator('.edit-bar').boundingBox();
    expect(panel!.y + panel!.height).toBeLessThanOrEqual(bar!.y + 1);
    await page.screenshot({ path: info.outputPath(`light-${width}.png`), fullPage: true, animations: 'disabled' });
    await page.getByRole('button', { name: 'Toggle theme' }).click();
    await page.screenshot({ path: info.outputPath(`dark-${width}.png`), fullPage: true, animations: 'disabled' });
  });
}

test('a real text selection can be locked with the keyboard', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Try a sample' }).click();
  const editor = page.getByRole('textbox', { name: 'Original draft' });
  await editor.focus();
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Home'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
  for (let i = 0; i < 6; i++) await page.keyboard.press('Shift+ArrowRight');
  await page.getByRole('button', { name: 'Lock selection' }).click();
  await page.getByRole('button', { name: /protected/ }).click();
  await expect(page.getByRole('dialog').getByText('client', { exact: true })).toBeVisible();
});

test('email import keeps the detected signature exactly in the export', async ({ page, modelServer }) => {
  await page.goto('/'); await connect(page, modelServer.url);
  const email = 'Hi Alex,\n\nPlease review the deployment plan before our next discussion.\n\nBest regards,\nMayank Raj\nEngineering\n';
  await page.locator('input[type=file]').setInputFiles({ name: 'email.txt', mimeType: 'text/plain', buffer: Buffer.from(email) });
  await expect(page.getByRole('textbox', { name: 'Original draft' })).toContainText('Mayank Raj');
  await page.getByRole('combobox', { name: 'Editing preset' }).selectOption('email');
  await page.getByRole('button', { name: 'Edit draft' }).click();
  await expect(page.getByText('Edit complete. Every lock checked.')).toBeVisible();
  const pending = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export' }).click();
  const download = await pending;
  expect(await readFile((await download.path())!, 'utf8')).toBe(email.replace('Please review', 'Please check'));
  for (const request of modelServer.requests) expect(request.messages[1].content).not.toContain('Mayank Raj');
});

test('broken locks retain the original passage and show a review flag', async ({ page, modelServer }, info) => {
  await page.goto('/'); await connect(page, modelServer.url, 'break-locks');
  await page.locator('input[type=file]').setInputFiles({ name: 'draft.md', mimeType: 'text/markdown', buffer: Buffer.from('This article discusses a precise limit of 42 ports per client.\n') });
  await page.getByRole('button', { name: 'Edit draft' }).click();
  await expect(page.getByRole('complementary', { name: 'Retained passages' })).toBeVisible();
  await openRetained(page);
  await expect(page.getByRole('button', { name: 'Show retained passage 1' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Edited result' })).toContainText('42 ports');
  await page.screenshot({ path: info.outputPath('original-retained.png'), fullPage: true, animations: 'disabled' });
});

test('respects reduced motion and the system dark preference', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const duration = await page.locator('.workspace').evaluate(el => getComputedStyle(el).animationDuration);
  expect(parseFloat(duration)).toBeLessThan(.001);
  await page.getByRole('button', { name: 'Toggle theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});
