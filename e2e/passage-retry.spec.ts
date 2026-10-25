import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { test, expect, connect, openRetained } from './fixtures';

const source = 'A concrete trace explains the approved introduction.\n\nMUST_RETAIN_A keeps an exact allocation limit of 42 ports.\n\nMUST_RETAIN_B keeps a separate allocation limit of 64 ports.\n\nThe final approved paragraph stays useful.\n';
const originalResult = source.replace('A concrete trace', 'A specific trace');
async function failedEdit(page: Page, url: string) {
  await page.goto('/'); await connect(page, url);
  await page.locator('input[type=file]').setInputFiles({ name: 'retry.md', mimeType: 'text/markdown', buffer: Buffer.from(source) });
  await expect(page.getByRole('textbox', { name: 'Original draft' })).toContainText('MUST_RETAIN_A');
  await page.getByRole('button', { name: 'Edit draft' }).click();
  await expect(page.getByText('Edit complete. Review retained passages in Edited.')).toBeVisible();
  await openRetained(page);
  await expect(page.getByRole('button', { name: 'Retry passage 1', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry passage 2', exact: true })).toBeVisible();
}
async function exported(page: Page) {
  const pending = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export', exact: true }).click();
  return readFile((await (await pending).path())!, 'utf8');
}

test('retry sends one passage, preserves other edits, shifts later links, and survives a saved reload', async ({ page, modelServer }, info) => {
  await failedEdit(page, modelServer.url);
  await page.getByLabel('Save drafts on this device').check();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('edittrace.v1.draft') ?? '{}').issues?.length)).toBe(2);
  await page.reload();
  await openRetained(page);
  await expect(page.getByRole('button', { name: 'Retry passage 1', exact: true })).toBeVisible();
  modelServer.control.repairRetained = true; modelServer.control.tokenInterval = 100;
  const count = modelServer.requests.length;
  await page.getByRole('button', { name: 'Retry passage 1', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retrying passage 1', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Retry passage 2', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeDisabled();
  await expect(page.getByText('Passage updated. 1 passage still needs review.')).toBeVisible();
  const requests = modelServer.requests.slice(count);
  expect(requests).toHaveLength(1);
  expect(requests[0].messages[1].content).toContain('MUST_RETAIN_A');
  for (const excluded of ['MUST_RETAIN_B', 'approved introduction', 'final approved', '42']) expect(requests[0].messages[1].content).not.toContain(excluded);
  expect(await exported(page)).toBe(originalResult.replace('MUST_RETAIN_A', 'Recovered passage_A'));
  await page.getByRole('button', { name: 'Show retained passage 1' }).click();
  await expect(page.locator('.result-panel .review-focus')).toContainText('MUST_RETAIN_B');
  await page.screenshot({ path: info.outputPath('retry-one-success.png'), fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Retry passage 1', exact: true }).click();
  await expect(page.getByText('Passage updated. Every lock checked.')).toBeVisible();
  expect(modelServer.requests.slice(count)).toHaveLength(2);
  expect(await exported(page)).toBe(originalResult.replaceAll('MUST_RETAIN', 'Recovered passage'));
  await expect(page.getByRole('complementary', { name: 'Retained passages' })).toHaveCount(0);
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await page.locator('.history-entry').last().click();
  await openRetained(page);
  await expect(page.getByRole('button', { name: 'Retry passage 2', exact: true })).toBeEnabled();
  expect(await exported(page)).toBe(originalResult);
});

test('failed validation and authentication leave the full previous result and flags intact', async ({ page, modelServer }) => {
  await failedEdit(page, modelServer.url);
  const count = modelServer.requests.length;
  await page.getByRole('button', { name: 'Retry passage 1', exact: true }).click();
  await expect(page.getByText('Passage kept original. Review the reason in Edited.')).toBeVisible();
  expect(modelServer.requests.slice(count)).toHaveLength(2);
  expect(await exported(page)).toBe(originalResult);
  modelServer.control.completionStatus = 401;
  await page.getByRole('button', { name: 'Retry passage 1', exact: true }).click();
  await expect(page.getByText('Authentication failed. Check the API key.')).toBeVisible();
  expect(modelServer.requests.slice(count)).toHaveLength(3);
  expect(await exported(page)).toBe(originalResult);
  await expect(page.getByRole('button', { name: 'Retry passage 2', exact: true })).toBeEnabled();
  modelServer.control.completionStatus = 200; modelServer.control.repairRetained = true;
  await page.getByRole('button', { name: 'Retry passage 1', exact: true }).click();
  await expect(page.getByText('Passage updated. 1 passage still needs review.')).toBeVisible();
});

test('stopping a streamed retry restores the kept passage and leaves other edits unchanged', async ({ page, modelServer }, info) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  await failedEdit(page, modelServer.url);
  modelServer.control.repairRetained = true; modelServer.control.tokenInterval = 1000;
  await page.getByRole('button', { name: 'Retry passage 1', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Edited result' })).toContainText('Recovered passage_A');
  await page.screenshot({ path: info.outputPath('retry-stream-mobile.png'), fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.getByText('Retry stopped. Previous result kept.')).toBeVisible();
  expect(await exported(page)).toBe(originalResult);
  await expect(page.getByRole('button', { name: 'Retry passage 1', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Retry passage 2', exact: true })).toBeEnabled();
});

for (const width of [320, 1440]) {
  test(`sample hover has padding and feedback opens GitHub without draft data at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: width === 320 ? 844 : 1000 }); await page.goto('/');
    const sample = page.getByRole('button', { name: 'Try a sample' });
    for (const theme of ['light', 'dark']) {
      if (theme === 'dark') await page.getByRole('button', { name: 'Toggle theme' }).click();
      await expect(sample).toBeInViewport({ ratio: 1 });
      await sample.hover();
      await expect(sample).toHaveCSS('background-color', theme === 'light' ? 'rgb(246, 234, 225)' : 'rgb(56, 45, 41)');
      const padding = await sample.evaluate(el => {
        const rect = el.getBoundingClientRect(), range = document.createRange(); range.selectNodeContents(el.firstChild!);
        const text = range.getBoundingClientRect(); return { left: text.left - rect.left, right: rect.right - text.right, height: rect.height };
      });
      expect(padding.left).toBeGreaterThanOrEqual(8); expect(padding.right).toBeGreaterThanOrEqual(22); expect(padding.height).toBeGreaterThanOrEqual(36);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await page.screenshot({ path: info.outputPath(`sample-hover-${theme}-${width}.png`), fullPage: true, animations: 'disabled' });
    }
    const feedback = page.getByRole('link', { name: 'Give feedback' });
    await expect(feedback).toBeVisible();
    await expect(feedback).toHaveAttribute('href', 'https://github.com/rajmayank/EditTrace/issues/new');
    await page.context().route('https://github.com/rajmayank/EditTrace/issues/new', route => route.fulfill({ body: '<h1>Feedback on GitHub</h1>', contentType: 'text/html' }));
    const pending = page.waitForEvent('popup'); await feedback.click(); const popup = await pending;
    await expect(popup.getByRole('heading', { name: 'Feedback on GitHub' })).toBeVisible();
    await expect(popup).toHaveURL('https://github.com/rajmayank/EditTrace/issues/new');
    await popup.close(); await expect(sample).toBeVisible();
  });
}
