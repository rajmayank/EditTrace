import { test, expect, connect } from './fixtures';

for (const size of [{ width: 1440, height: 2200 }, { width: 1920, height: 2600 }, { width: 390, height: 1800 }]) {
  test(`footer and workspace fill a tall ${size.width}×${size.height} viewport`, async ({ page }, info) => {
    await page.setViewportSize(size); await page.goto('/');
    await page.getByRole('button', { name: 'Toggle theme' }).click();
    const footer = await page.locator('.app-footer').boundingBox();
    expect(footer!.y + footer!.height).toBeGreaterThanOrEqual(size.height - 28);
    expect(footer!.y + footer!.height).toBeLessThanOrEqual(size.height + 2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(size.width);
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(17, 19, 24)');
    await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(17, 19, 24)');
    await expect(page.getByText('0.1', { exact: true })).toHaveCount(0);
    await expect(page.getByText('No tracking. No server-side storage.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Mayank Raj', exact: true })).toHaveAttribute('href', 'https://mayankraj.com');
    await page.screenshot({ path: info.outputPath('tall-dark.png'), fullPage: true, animations: 'disabled' });
  });
}

test('connection results are visible beside Test and providers have helper defaults', async ({ page, modelServer }, info) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Connect a model' }).click();
  const presets = page.getByRole('group', { name: 'Provider presets' });
  await expect(presets.getByRole('button')).toHaveCount(6);
  await presets.getByRole('button', { name: 'Ollama', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Server URL' })).toHaveValue('http://localhost:11434/v1');
  await presets.getByRole('button', { name: 'External', exact: true }).click();
  await page.getByRole('textbox', { name: 'Server URL' }).fill(modelServer.url);
  modelServer.control.modelDelay = 650;
  await page.getByRole('button', { name: 'Test connection' }).click();
  await expect(page.getByText('Checking server and discovering models…')).toBeVisible();
  await expect(page.getByText('Connected. 2 models available.')).toBeInViewport();
  await expect(page.getByRole('combobox', { name: 'Default model' }).getByRole('option')).toHaveCount(2);
  await expect(page.getByText(/No background service/)).toBeVisible();
  await page.screenshot({ path: info.outputPath('connection-success.png'), animations: 'disabled' });
  modelServer.control.modelStatus = 401;
  await page.getByRole('button', { name: 'Test connection' }).click();
  await expect(page.getByRole('alert')).toContainText('Authentication failed');
  await expect(page.getByRole('alert')).toBeInViewport();
  await page.screenshot({ path: info.outputPath('connection-error.png'), animations: 'disabled' });
});

test('refresh rechecks the badge, disconnect clears keys, and reconnect works', async ({ page, modelServer }) => {
  await page.goto('/'); await connect(page, modelServer.url);
  modelServer.control.modelDelay = 800;
  await page.reload();
  await expect(page.locator('.connection-pill')).toHaveAttribute('data-connection-state', 'checking');
  await expect(page.locator('.connection-pill')).toHaveAttribute('data-connection-state', 'connected');
  await page.locator('.connection-pill').click();
  await page.getByLabel(/API key optional/).fill('test-browser-key');
  await page.getByLabel('Remember API key on this device').check();
  await page.getByRole('button', { name: 'Test connection' }).click();
  await expect(page.getByText('Connected. 2 models available.')).toBeVisible();
  await page.getByRole('button', { name: 'Disconnect' }).click();
  await expect(page.locator('.connection-pill')).toHaveAttribute('data-connection-state', 'disconnected');
  expect(await page.evaluate(() => localStorage.getItem('edittrace.v1.settings'))).not.toContain('test-browser-key');
  await page.reload();
  await expect(page.locator('.connection-pill')).toHaveAttribute('data-connection-state', 'disconnected');
  await page.locator('.connection-pill').click();
  await page.getByRole('button', { name: 'Test connection' }).click();
  await expect(page.getByText('Connected. 2 models available.')).toBeVisible();
});

test('streaming starts empty and never displays future paragraphs', async ({ page, modelServer }, info) => {
  await page.goto('/'); await connect(page, modelServer.url);
  modelServer.control.tokenDelay = 1200;
  const text = 'FIRST passage explains how connection allocation works.\n\nFUTURE paragraph has not been processed yet.\n';
  await page.locator('input[type=file]').setInputFiles({ name: 'stream.md', mimeType: 'text/markdown', buffer: Buffer.from(text) });
  await page.getByRole('button', { name: 'Edit draft' }).click();
  await expect(page.getByText('Waiting for your model…')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Edited result' })).toHaveCount(0);
  await expect(page.locator('.result-panel')).not.toContainText('FIRST passage');
  await expect(page.getByRole('textbox', { name: 'Edited result' })).toContainText('FIRST');
  await expect(page.locator('.result-panel')).not.toContainText('FUTURE');
  await page.screenshot({ path: info.outputPath('streaming-partial.png'), fullPage: true, animations: 'disabled' });
  await expect(page.getByText('Edit complete. Every lock checked.')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Edited result' })).toContainText('FUTURE');
});

test('a successful stream updates a failed connection badge', async ({ page, modelServer }) => {
  await page.goto('/'); await connect(page, modelServer.url);
  modelServer.control.modelStatus = 401;
  await page.locator('.connection-pill').click();
  await page.getByRole('button', { name: 'Test connection' }).click();
  await expect(page.locator('.connection-pill')).toHaveAttribute('data-connection-state', 'error');
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Try a sample' }).click();
  await page.getByRole('button', { name: 'Edit draft' }).click();
  await expect(page.getByText('Edit complete. Every lock checked.')).toBeVisible();
  await expect(page.locator('.connection-pill')).toHaveAttribute('data-connection-state', 'connected');
});

test('connection feedback stays visible on a narrow dark screen', async ({ page, modelServer }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Connect a model' }).click();
  await page.getByRole('textbox', { name: 'Server URL' }).fill(modelServer.url);
  await page.getByRole('button', { name: 'Test connection' }).click();
  await expect(page.getByText('Connected. 2 models available.')).toBeInViewport();
  expect(await page.getByRole('dialog').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('connection-mobile-dark.png'), animations: 'disabled' });
});
