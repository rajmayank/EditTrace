import type { Page } from '@playwright/test';
import { test, expect, connect } from './fixtures';

async function sampleResult(page: Page, url: string) {
  await page.goto('/'); await connect(page, url);
  await page.getByRole('button', { name: 'Try a sample' }).click();
  await page.getByRole('button', { name: 'Edit draft' }).click();
  await expect(page.getByText('Edit complete. Every lock checked.')).toBeVisible();
}

async function fillsViewport(page: Page) {
  const size = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  const workspace = await page.locator('.workspace').boundingBox();
  expect(workspace!.y).toBeLessThan(60);
  expect(workspace!.height).toBeGreaterThan(size.height * .75);
  expect(workspace!.x + workspace!.width).toBeLessThanOrEqual(size.width);
  const action = await page.getByRole('button', { name: 'Exit focus mode' }).boundingBox();
  expect(action!.y + action!.height).toBeLessThanOrEqual(size.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test('Feedback has the same unboxed surface as Help', async ({ page }) => {
  await page.goto('/');
  const feedback = page.getByRole('link', { name: 'Give feedback' });
  await expect(feedback).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(feedback).toHaveCSS('border-top-width', '0px');
  await expect(feedback).toHaveAttribute('href', 'https://github.com/rajmayank/EditTrace/issues/new');
});

test('fullscreen preserves inline edits, undo, locks, and mounted panes while collapsing either side', async ({ page, modelServer }, info) => {
  await sampleResult(page, modelServer.url);
  const result = page.getByRole('textbox', { name: 'Edited result' });
  await page.getByRole('group', { name: 'Edited view' }).getByRole('button', { name: 'Edit', exact: true }).click();
  const editor = await result.elementHandle();
  await page.getByRole('button', { name: 'Enter focus mode' }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === document.documentElement)).toBe(true);
  await expect(page.locator('.topbar')).not.toBeVisible();
  await expect(page.locator('.document-bar')).not.toBeVisible();
  await expect(page.locator('.app-footer')).not.toBeVisible();
  await fillsViewport(page);
  await result.focus(); await page.keyboard.press('Control+End'); await page.keyboard.type('Local focus note.');
  await expect(result).toContainText('Local focus note.');
  await page.getByRole('button', { name: 'Collapse Edited pane' }).click();
  await expect(result).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Restore Edited pane' })).toBeFocused();
  await page.screenshot({ path: info.outputPath('focus-original-only.png'), fullPage: true, animations: 'disabled' });
  // Collapsing the other side always opens the previously collapsed pane.
  await page.getByRole('button', { name: 'Collapse Original pane' }).click();
  await expect(result).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Original draft' })).not.toBeVisible();
  await page.screenshot({ path: info.outputPath('focus-edited-only.png'), fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Restore Original pane' }).click();
  expect(await result.evaluate((node, previous) => node === previous, editor)).toBe(true);
  await expect(page.locator('.result-panel .locked').first()).toBeVisible();
  await expect(page.locator('.result-panel .added').first()).toBeVisible();
  await result.focus(); await page.keyboard.press('Control+z');
  await expect(result).not.toContainText('Local focus note.');
  await page.screenshot({ path: info.outputPath('focus-both-light.png'), fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Exit focus mode' }).click();
  await expect(page.getByRole('button', { name: 'Enter focus mode' })).toBeFocused();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull();
  await page.getByRole('button', { name: 'Toggle theme' }).click();
  await page.getByRole('button', { name: 'Enter focus mode' }).click();
  await page.screenshot({ path: info.outputPath('focus-both-dark.png'), fullPage: true, animations: 'disabled' });
  await page.keyboard.press('Escape');
  await expect(page.locator('.app-shell')).not.toHaveClass(/focus-mode/);
  await expect(result).toHaveAttribute('contenteditable', 'true');
});

test('collapse and restore also work in the regular workspace, and change navigation reveals Original', async ({ page, modelServer }) => {
  await sampleResult(page, modelServer.url);
  await page.getByRole('button', { name: 'Collapse Original pane' }).click();
  await expect(page.getByRole('textbox', { name: 'Original draft' })).not.toBeVisible();
  const wide = await page.locator('.result-panel').boundingBox();
  expect(wide!.width).toBeGreaterThan(1100);
  await page.getByRole('button', { name: 'Next change' }).click();
  await expect(page.getByRole('textbox', { name: 'Original draft' })).toBeVisible();
  await page.getByRole('button', { name: 'Collapse Edited pane' }).click();
  await expect(page.getByRole('textbox', { name: 'Edited result' })).not.toBeVisible();
  await page.getByRole('button', { name: 'Restore Edited pane' }).click();
  await expect(page.getByRole('textbox', { name: 'Edited result' })).toBeVisible();
});

test('a browser fullscreen exit also restores the normal workspace', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Enter focus mode' }).click();
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  await page.evaluate(() => document.exitFullscreen());
  await expect(page.locator('.app-shell')).not.toHaveClass(/focus-mode/);
  await expect(page.getByRole('button', { name: 'Enter focus mode' })).toBeFocused();
});

test('focus still fills the viewport when fullscreen is denied, and Escape closes a dialog first', async ({ page }, info) => {
  await page.addInitScript(() => {
    Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true });
    Element.prototype.requestFullscreen = () => Promise.reject(new DOMException('Fullscreen denied', 'NotAllowedError'));
    localStorage.setItem('edittrace.v1.settings', JSON.stringify({ connectionEnabled: false }));
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Try a sample' }).click();
  await page.getByRole('button', { name: 'Enter focus mode' }).click();
  await expect(page.locator('.app-shell')).toHaveClass(/focus-mode/);
  expect(await page.evaluate(() => document.fullscreenElement)).toBeNull();
  await fillsViewport(page);
  await page.getByRole('button', { name: 'Edit draft' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.locator('.app-shell')).toHaveClass(/focus-mode/);
  await page.screenshot({ path: info.outputPath('focus-fullscreen-fallback.png'), fullPage: true, animations: 'disabled' });
  await page.keyboard.press('Escape');
  await expect(page.locator('.app-shell')).not.toHaveClass(/focus-mode/);
});

test('generation reveals a collapsed output pane and Stop remains accessible in focus', async ({ page, modelServer }) => {
  await page.goto('/'); await connect(page, modelServer.url);
  await page.getByRole('button', { name: 'Try a sample' }).click();
  await page.getByRole('button', { name: 'Enter focus mode' }).click();
  await page.getByRole('button', { name: 'Collapse Edited pane' }).click();
  modelServer.control.tokenDelay = 1500;
  await page.getByRole('button', { name: 'Edit draft' }).click();
  await expect(page.locator('.workspace')).toHaveAttribute('data-collapsed', 'none');
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeInViewport();
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.getByText('Stopped. Unfinished passages kept original.')).toBeVisible();
  await expect(page.locator('.app-shell')).toHaveClass(/focus-mode/);
  await page.getByRole('button', { name: 'Exit focus mode' }).click();
  await expect(page.getByRole('button', { name: 'Edit draft' })).toBeVisible();
});

for (const width of [320, 390, 768]) {
  test(`focus layout and both editor views fit at ${width}px`, async ({ page, modelServer }, info) => {
    await page.setViewportSize({ width, height: 844 });
    await sampleResult(page, modelServer.url);
    await page.getByRole('button', { name: 'Enter focus mode' }).click();
    await fillsViewport(page);
    if (width < 701) {
      const panes = page.getByRole('group', { name: 'Editor panel' });
      await panes.getByRole('button', { name: 'Original' }).click();
      await expect(page.getByRole('textbox', { name: 'Original draft' })).toBeVisible();
      await expect(page.getByRole('textbox', { name: 'Edited result' })).not.toBeVisible();
      await panes.getByRole('button', { name: 'Edited' }).click();
    }
    await expect(page.getByRole('textbox', { name: 'Edited result' })).toBeVisible();
    await page.screenshot({ path: info.outputPath(`focus-light-${width}.png`), fullPage: true, animations: 'disabled' });
    await page.getByRole('button', { name: 'Exit focus mode' }).click();
    await page.getByRole('button', { name: 'Toggle theme' }).click();
    await page.getByRole('button', { name: 'Enter focus mode' }).click();
    await fillsViewport(page);
    await page.screenshot({ path: info.outputPath(`focus-dark-${width}.png`), fullPage: true, animations: 'disabled' });
    await page.getByRole('button', { name: 'Exit focus mode' }).click();
    await expect(page.locator('.topbar')).toBeVisible();
  });
}
