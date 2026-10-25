import { test, expect, connect } from './fixtures';

for (const width of [320, 1440]) {
  test(`footer, draft saving, and protection helpers stay clear at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: width === 320 ? 844 : 1000 });
    await page.goto('/');
    const footer = page.locator('.app-footer');
    await expect(footer.getByRole('link', { name: 'Mayank Raj', exact: true })).toHaveAttribute('href', 'https://mayankraj.com');
    await expect(footer).not.toContainText('MayankRaj.com');
    await expect(footer.getByRole('link', { name: 'GitHub repo' })).toHaveAttribute('href', 'https://github.com/rajmayank/EditTrace');
    await expect(footer.getByRole('checkbox')).toHaveCount(0);
    const save = page.locator('.workspace-preferences').getByLabel('Save drafts on this device');
    await expect(save).toBeVisible(); await save.check();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('edittrace.v1.settings')!).saveDrafts)).toBe(true);
    await save.uncheck();
    await page.getByRole('button', { name: 'Try a sample' }).click();
    await expect(page.getByLabel('Original word count and reading time')).toContainText('1 min read');
    await expect(page.locator('.draft-panel .word-count')).toBeVisible();
    for (const theme of ['light', 'dark']) {
      if (theme === 'dark') await page.getByRole('button', { name: 'Toggle theme' }).click();
      await page.getByRole('button', { name: /protected/ }).click();
      await expect(page.getByRole('note')).toContainText('Protected text stays word for word.');
      await expect(page.getByText(/Heading wording stays editable/)).toBeVisible();
      await expect(page.getByText(/Use for figures that must stay exact/)).toBeVisible();
      await expect(page.getByText(/quoted threads in Email mode/)).toBeVisible();
      expect(await page.getByRole('dialog').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath(`protection-${theme}-${width}.png`), animations: 'disabled' });
      await page.keyboard.press('Escape');
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await page.screenshot({ path: info.outputPath(`workspace-${theme}-${width}.png`), fullPage: true, animations: 'disabled' });
    }
  });
}

test('both panels update reading estimates and completed speed survives an opted-in reload', async ({ page, modelServer }) => {
  await page.goto('/'); await connect(page, modelServer.url);
  const text = '# A closer look at connection limits\n\n' + 'detail '.repeat(196);
  await page.locator('input[type=file]').setInputFiles({ name: 'reading.md', mimeType: 'text/markdown', buffer: Buffer.from(text) });
  const original = page.getByLabel('Original word count and reading time');
  await expect(original).toContainText('202 words'); await expect(original).toContainText('2 min read');
  await page.getByRole('button', { name: 'Edit draft' }).click();
  await expect(page.getByText('Edit complete. Every lock checked.')).toBeVisible();
  const edited = page.getByLabel('Edited word count and reading time');
  await expect(edited).toContainText('199 words'); await expect(edited).toContainText('1 min read');
  const rate = page.getByLabel('Model output speed');
  await expect(rate).toContainText(/≈ [\d,]+ words\/min/);
  const completed = await rate.textContent();
  await page.getByLabel('Save drafts on this device').check();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('edittrace.v1.draft') ?? '{}').stats?.words ?? 0)).toBeGreaterThan(0);
  await page.reload();
  await expect(page.getByLabel('Model output speed')).toHaveText(completed!);
  await expect(page.getByLabel('Edited word count and reading time')).toContainText('199 words');
});

test('live speed includes waiting time, the solid Stop icon is visible, and completion freezes the figures', async ({ page, modelServer }, info) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.goto('/'); await connect(page, modelServer.url);
  await page.getByRole('button', { name: 'Toggle theme' }).click();
  const text = 'Please review the deployment details before sharing them. '.repeat(8);
  await page.locator('input[type=file]').setInputFiles({ name: 'speed.txt', mimeType: 'text/plain', buffer: Buffer.from(text) });
  await expect(page.getByRole('textbox', { name: 'Original draft' })).toContainText('deployment details');
  modelServer.control.tokenDelay = 1800; modelServer.control.tokenInterval = 100;
  await page.getByRole('button', { name: 'Edit draft' }).click();
  const rate = page.getByLabel('Model output speed');
  await expect(rate).toContainText('— words/min');
  await expect(page.getByRole('button', { name: 'Stop', exact: true }).locator('svg')).toHaveAttribute('fill', 'currentColor');
  await expect(rate).toContainText(/≈ [\d,]+ words\/min/);
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('live-speed-stop-mobile-dark.png'), fullPage: true, animations: 'disabled' });
  await expect(page.getByText('Edit complete. Every lock checked.')).toBeVisible({ timeout: 10000 });
  const completed = await rate.textContent();
  await page.waitForTimeout(700); // A completed result must stop ticking after the live interval ends.
  await expect(rate).toHaveText(completed!);
});

test('reading time and word counts grow before streaming completes', async ({ page, modelServer }) => {
  await page.goto('/'); await connect(page, modelServer.url);
  await page.locator('input[type=file]').setInputFiles({ name: 'growing.txt', mimeType: 'text/plain', buffer: Buffer.from('detail '.repeat(250)) });
  await expect(page.getByRole('textbox', { name: 'Original draft' })).toContainText('detail');
  modelServer.control.tokenInterval = 60;
  await page.getByRole('button', { name: 'Edit draft' }).click();
  const reading = page.getByLabel('Edited word count and reading time');
  await expect(reading).toContainText('<1 min read');
  await expect(reading).toContainText('2 min read', { timeout: 10000 });
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
  await expect(page.getByText('Edit complete. Every lock checked.')).toBeVisible({ timeout: 10000 });
  await expect(reading).toContainText('250 words');
});

for (const width of [390, 1440]) {
  test(`retained passages start collapsed and scroll within their own list at ${width}px`, async ({ page, modelServer }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/'); await connect(page, modelServer.url);
    const text = Array.from({ length: 6 }, (_, i) => `MUST_RETAIN_${i} keeps an exact allocation limit of ${42 + i} ports.`).join('\n\n');
    await page.locator('input[type=file]').setInputFiles({ name: 'many.md', mimeType: 'text/markdown', buffer: Buffer.from(text) });
    await expect(page.getByRole('textbox', { name: 'Original draft' })).toContainText('MUST_RETAIN_0');
    await page.getByRole('button', { name: 'Edit draft' }).click();
    await expect(page.getByText('Edit complete. Review retained passages in Edited.')).toBeVisible();
    const details = page.locator('.retained-review details'), summary = details.locator('summary');
    await expect(summary).toContainText('6 original passages kept');
    await expect(details).not.toHaveAttribute('open');
    expect((await details.boundingBox())!.height).toBeLessThanOrEqual(40);
    await page.screenshot({ path: info.outputPath(`retained-collapsed-${width}.png`), fullPage: true, animations: 'disabled' });
    await summary.focus(); await page.keyboard.press('Enter');
    await expect(details).toHaveAttribute('open');
    const list = details.locator('ol');
    expect(await list.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
    expect((await list.boundingBox())!.height).toBeLessThanOrEqual(width < 700 ? 110 : 125);
    await list.evaluate(el => { el.scrollTop = el.scrollHeight; });
    await expect(page.getByRole('button', { name: 'Retry passage 6', exact: true })).toBeInViewport();
    await page.getByRole('button', { name: 'Show retained passage 6' }).click();
    await expect(page.locator('.result-panel .review-focus')).toContainText('MUST_RETAIN_5');
    await page.getByRole('button', { name: 'Toggle theme' }).click();
    await page.screenshot({ path: info.outputPath(`retained-expanded-dark-${width}.png`), fullPage: true, animations: 'disabled' });
    await summary.click(); await expect(list).not.toBeVisible();
  });
}
