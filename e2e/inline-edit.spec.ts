import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { test, expect, connect, openRetained } from './fixtures';

const source = '# A closer look at connection limits\n\nA client can have room while another client waits for 42 requests.\n\nRun `ss -s` and read [the guide](https://example.com/guide).\n\n```sh\nss -s\n```\n\nA final paragraph keeps the explanation in place.\n';

async function prepare(page: Page, url: string, text = source, format = 'markdown') {
  await page.addInitScript(({ text, format, fact }) => {
    localStorage.setItem('edittrace.v1.settings', JSON.stringify({ saveDrafts: true, connectionEnabled: false }));
    localStorage.setItem('edittrace.v1.draft', JSON.stringify({ source: text, output: '', manual: text.includes('another client') ? [{ from: fact, to: fact + 6 }] : [], format, name: format === 'markdown' ? 'Inline.md' : 'Inline.txt' }));
  }, { text, format, fact: text.lastIndexOf('client') });
  await page.goto('/'); await connect(page, url);
}

async function run(page: Page) {
  await page.getByRole('button', { name: 'Edit draft' }).click();
  await expect(page.getByText('Edit complete. Every lock checked.')).toBeVisible();
  await expect(page.getByRole('group', { name: 'Edited view' }).getByRole('button', { name: 'Edit', exact: true })).toBeEnabled();
}

async function selectText(page: Page, phrase: string) {
  const box = await page.getByRole('textbox', { name: 'Edited result' }).evaluate((root, phrase) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const at = walker.currentNode.textContent?.indexOf(phrase) ?? -1;
      if (at < 0) continue;
      const range = document.createRange(); range.setStart(walker.currentNode, at); range.setEnd(walker.currentNode, at + phrase.length);
      const r = range.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height };
    }
    throw new Error('Requested output text is not rendered: ' + phrase);
  }, phrase);
  await page.mouse.move(box.x + 1, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2, { steps: 8 }); await page.mouse.up();
}

test('shows inherited facts and notation, edits prose locally, and keeps undo through reading view', async ({ page, modelServer }, info) => {
  await prepare(page, modelServer.url); await run(page);
  const result = page.getByRole('textbox', { name: 'Edited result' });
  await expect(result).toHaveAttribute('contenteditable', 'false');
  const factMark = page.locator('.result-panel .locked[title*="Fact"]');
  await expect(factMark).toHaveText('client');
  await expect(page.locator('.result-panel .locked[title*="Heading marker"]').first()).toHaveText('# ');
  await expect(page.locator('.result-panel .locked[title*="Number"]')).toContainText('42');
  const requests = modelServer.requests.length;
  const words = await page.getByLabel('Edited word count and reading time').textContent();
  await page.getByRole('group', { name: 'Edited view' }).getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(result).toHaveAttribute('contenteditable', 'true');
  await expect(page.locator('.result-panel .added').first()).toBeVisible();
  await expect(page.locator('.draft-panel .removed').first()).toBeVisible();
  await selectText(page, 'A final paragraph');
  await page.keyboard.type('An expanded closing paragraph');
  await expect(result).toContainText('An expanded closing paragraph');
  await expect(page.locator('.result-panel .added').filter({ hasText: 'expanded' })).toBeVisible();
  await page.getByLabel('Show changes', { exact: true }).uncheck();
  await expect(page.locator('.result-panel .added')).toHaveCount(0);
  await expect(factMark).toHaveText('client');
  await page.getByLabel('Show changes', { exact: true }).check();
  await expect(page.locator('.result-panel .added').filter({ hasText: 'expanded' })).toBeVisible();
  await expect(page.getByLabel('Edited word count and reading time')).not.toHaveText(words!);
  await expect(page.getByRole('textbox', { name: 'Original draft' })).toContainText('A final paragraph');
  await expect(factMark).toHaveText('client');
  await page.getByRole('group', { name: 'Edited view' }).getByRole('button', { name: 'Read', exact: true }).click();
  await expect(page.getByLabel('Markdown preview')).toContainText('An expanded closing paragraph');
  await page.getByRole('group', { name: 'Edited view' }).getByRole('button', { name: 'Edit', exact: true }).click();
  await result.focus(); await page.keyboard.press('Control+z');
  await expect(result).toContainText('A final paragraph');
  await page.keyboard.press('Control+Shift+z');
  await expect(result).toContainText('An expanded closing paragraph');
  const toggle = page.getByRole('group', { name: 'Edited view' }).getByRole('button', { name: 'Edit', exact: true });
  await toggle.click(); await expect(result).toHaveAttribute('contenteditable', 'false');
  await toggle.click(); await expect(result).toHaveAttribute('contenteditable', 'true');
  await result.focus(); await page.keyboard.press('Control+Home');
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Shift+End');
  await page.keyboard.type('A revised heading');
  await expect(result).toContainText('# A revised heading');
  await expect(page.locator('.result-panel .locked[title*="Heading marker"]').first()).toHaveText('# ');
  expect(modelServer.requests.length).toBe(requests);
  await page.screenshot({ path: info.outputPath('inline-light.png'), fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Toggle theme' }).click();
  await page.screenshot({ path: info.outputPath('inline-dark.png'), fullPage: true, animations: 'disabled' });
});

test('a long rewrite stays highlighted in Edit, including while typing and after undo', async ({ page }, info) => {
  const original = Array.from({ length: 100 }, (_, i) => `A concrete trace of client ${i} explains how the local connection limit differs from translated source port allocation. It gives engineers a useful way to investigate failures without conflating their causes.`).join('\n\n');
  const edited = Array.from({ length: 100 }, (_, i) => `Tracing request ${i} makes the distinction clear: the operating system allocates one endpoint, and the gateway allocates another. Follow each allocation to understand why the connection failed and choose the right fix.`).join('\n\n');
  await page.addInitScript(({ source, output }) => {
    localStorage.setItem('edittrace.v1.settings', JSON.stringify({ saveDrafts: true, connectionEnabled: false, locks: { structure: false, inline: false, numbers: false, signature: false } }));
    localStorage.setItem('edittrace.v1.draft', JSON.stringify({ source, output, outputLocks: [], manual: [], format: 'text', name: 'Long rewrite.txt' }));
  }, { source: original, output: edited });
  await page.goto('/');
  const result = page.getByRole('textbox', { name: 'Edited result' });
  const view = page.getByRole('group', { name: 'Edited view' });
  await expect(page.locator('.result-panel .added').first()).toBeVisible();
  await view.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.locator('.result-panel .added').first()).toBeVisible();
  await result.focus(); await page.keyboard.press('Control+Home');
  await page.keyboard.type('A local clarification. ', { delay: 15 });
  await expect(result).toContainText('A local clarification.');
  await expect(page.locator('.result-panel .added').first()).toContainText('local clarification.');
  await expect(page.locator('.draft-panel .removed').first()).toBeVisible();
  await page.keyboard.press('Control+z');
  await expect(result).not.toContainText('A local clarification.');
  await expect(page.locator('.result-panel .added').first()).toBeVisible();
  await expect(page.locator('.change-navigation')).not.toContainText('refresh');
  await page.screenshot({ path: info.outputPath('long-inline-light.png'), fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Toggle theme' }).click();
  await page.screenshot({ path: info.outputPath('long-inline-dark.png'), fullPage: true, animations: 'disabled' });
});

test('typing, paste, cut, and delete cannot replace protected output', async ({ page, modelServer }) => {
  await prepare(page, modelServer.url); await run(page);
  await page.getByRole('group', { name: 'Edited view' }).getByRole('button', { name: 'Edit', exact: true }).click();
  const result = page.getByRole('textbox', { name: 'Edited result' });
  const before = await result.textContent();
  await selectText(page, '42'); await page.keyboard.type('99');
  await expect(page.getByText('Protected text stays locked. Change or unlock it in Original.')).toBeVisible();
  await expect(result).toContainText('42');
  await selectText(page, 'client'); await page.keyboard.press('Backspace');
  await expect(page.locator('.result-panel .locked[title*="Fact"]')).toHaveText('client');
  await result.focus(); await page.keyboard.press('Control+a');
  await result.evaluate(el => {
    const clipboardData = new DataTransfer(); clipboardData.setData('text/plain', 'A replacement that loses every fact.');
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  });
  expect(await result.textContent()).toBe(before);
  await page.keyboard.press('Control+x');
  expect(await result.textContent()).toBe(before);
});

test('local edits persist, export the current text, and retain mapped protections after refresh', async ({ page, modelServer }) => {
  await prepare(page, modelServer.url); await run(page);
  await page.getByRole('group', { name: 'Edited view' }).getByRole('button', { name: 'Edit', exact: true }).click();
  await selectText(page, 'A final paragraph'); await page.keyboard.type('A clearer conclusion');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('edittrace.v1.draft')!).output)).toContain('A clearer conclusion');
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export', exact: true }).click();
  const file = await download;
  const exported = await readFile((await file.path())!, 'utf8');
  expect(exported).toContain('A clearer conclusion'); expect(exported).toContain('42'); expect(exported).toContain('[the guide](https://example.com/guide)');
  const saved = await page.evaluate(() => localStorage.getItem('edittrace.v1.draft'));
  // Remove the setup script before reloading by navigating in a new page in the same browser context.
  const fresh = await page.context().newPage();
  await fresh.goto('/');
  await expect(fresh.getByRole('textbox', { name: 'Edited result' })).toContainText('A clearer conclusion');
  await expect(fresh.locator('.result-panel .locked[title*="Fact"]')).toHaveText('client');
  await expect(fresh.getByRole('group', { name: 'Edited view' }).getByRole('button', { name: 'Edit', exact: true })).toBeEnabled();
  expect(JSON.parse(saved!).outputLocks.length).toBeGreaterThan(0);
});

test('ambiguous older results stay read-only instead of guessing which repeated fact was locked', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('edittrace.v1.settings', JSON.stringify({ saveDrafts: true, connectionEnabled: false, locks: { structure: false, inline: false, numbers: false, signature: false } }));
    localStorage.setItem('edittrace.v1.draft', JSON.stringify({ source: 'A fact and fact.', output: 'A fact, fact, and fact.', manual: [{ from: 2, to: 6 }], format: 'text', name: 'Older.txt' }));
  });
  await page.goto('/');
  await expect(page.getByRole('group', { name: 'Edited view' }).getByRole('button', { name: 'Edit', exact: true })).toBeDisabled();
  await expect(page.getByText('Run a fresh edit to refresh protected ranges before editing inline.')).toBeVisible();
});

test('an unprotected result can be emptied and typed into without losing the editing surface', async ({ page, modelServer }) => {
  await prepare(page, modelServer.url, 'A plain sentence.', 'text'); await run(page);
  await page.getByRole('group', { name: 'Edited view' }).getByRole('button', { name: 'Edit', exact: true }).click();
  const result = page.getByRole('textbox', { name: 'Edited result' });
  await result.focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('Backspace');
  await expect(result).toBeVisible(); await page.keyboard.type('A completely revised sentence.');
  await expect(result).toContainText('A completely revised sentence.');
});

for (const width of [320, 390]) {
  test(`inline editing fits the ${width}px panel and keeps the original unchanged`, async ({ page, modelServer }, info) => {
    await page.setViewportSize({ width, height: 844 });
    await prepare(page, modelServer.url); await run(page);
    const edit = page.getByRole('group', { name: 'Edited view' }).getByRole('button', { name: 'Edit', exact: true });
    await edit.click();
    const result = page.getByRole('textbox', { name: 'Edited result' });
    await result.focus(); await page.keyboard.press('Control+End'); await page.keyboard.type('Local note.');
    await expect(result).toContainText('Local note.');
    expect(await page.locator('.draft-panel .cm-content').textContent()).not.toContain('Local note.');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(edit).toHaveAttribute('aria-pressed', 'true');
    await page.screenshot({ path: info.outputPath(`inline-${width}.png`), fullPage: true, animations: 'disabled' });
  });
}

test('CRLF email signatures stay locked and export byte-for-byte after local prose edits', async ({ page, modelServer }) => {
  const signature = 'Best regards,\r\nMayank Raj\r\nEngineering\r\n';
  const email = 'Hi Alex,\r\n\r\nPlease review the deployment plan.\r\n\r\n' + signature;
  await prepare(page, modelServer.url, email, 'email'); await run(page);
  await expect(page.locator('.result-panel .locked[title*="Signature"]').first()).toContainText('Best regards,');
  await page.getByRole('group', { name: 'Edited view' }).getByRole('button', { name: 'Edit', exact: true }).click();
  await selectText(page, 'deployment plan'); await page.keyboard.type('rollout plan');
  await selectText(page, 'Mayank Raj'); await page.keyboard.press('Backspace');
  await expect(page.getByRole('textbox', { name: 'Edited result' })).toContainText('Mayank Raj');
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export', exact: true }).click();
  const file = await download; const exported = await readFile((await file.path())!, 'utf8');
  expect(exported).toContain('rollout plan'); expect(exported.endsWith(signature)).toBe(true);
  expect(exported.replaceAll('\r\n', '')).not.toContain('\n');
});

test('locks remain visible during streaming and inline editing waits for the model to finish', async ({ page, modelServer }) => {
  modelServer.control.tokenDelay = 400;
  await prepare(page, modelServer.url);
  await page.getByRole('button', { name: 'Edit draft' }).click();
  await expect(page.locator('.result-panel .locked[title*="Number"]')).toContainText('42');
  await expect(page.getByRole('group', { name: 'Edited view' }).getByRole('button', { name: 'Edit', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.getByText('Stopped. Unfinished passages kept original.')).toBeVisible();
  await expect(page.getByRole('group', { name: 'Edited view' }).getByRole('button', { name: 'Edit', exact: true })).toBeEnabled();
});

test('retrying a retained passage preserves local edits and shifts inherited protections', async ({ page, modelServer }) => {
  const text = 'A starting paragraph.\n\nMUST_RETAIN keeps 42 requests.\n\nA final paragraph.';
  await prepare(page, modelServer.url, text);
  await page.getByRole('button', { name: 'Edit draft' }).click();
  await expect(page.getByText('Edit complete. Review retained passages in Edited.')).toBeVisible();
  await page.getByRole('group', { name: 'Edited view' }).getByRole('button', { name: 'Edit', exact: true }).click();
  await selectText(page, 'A starting paragraph'); await page.keyboard.type('An expanded introduction');
  await openRetained(page);
  modelServer.control.repairRetained = true;
  await page.getByRole('button', { name: 'Retry passage 1', exact: true }).click();
  await expect(page.getByText('Passage updated. Every lock checked.')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Edited result' })).toContainText('An expanded introduction');
  await expect(page.locator('.result-panel .locked[title*="Number"]')).toContainText('42');
  await expect(page.getByRole('group', { name: 'Edited view' }).getByRole('button', { name: 'Edit', exact: true })).toBeEnabled();
});

test('manually fixing a retained passage clears its flag without changing its protected facts', async ({ page, modelServer }) => {
  await prepare(page, modelServer.url, 'MUST_RETAIN keeps 42 requests.');
  await page.getByRole('button', { name: 'Edit draft' }).click();
  await expect(page.getByText('Edit complete. Review retained passages in Edited.')).toBeVisible();
  const requests = modelServer.requests.length;
  await page.getByRole('group', { name: 'Edited view' }).getByRole('button', { name: 'Edit', exact: true }).click();
  await selectText(page, 'MUST_RETAIN'); await page.keyboard.type('A manually repaired passage');
  await expect(page.getByRole('complementary', { name: 'Retained passages' })).toHaveCount(0);
  await expect(page.locator('.result-panel .locked[title*="Number"]')).toContainText('42');
  expect(modelServer.requests.length).toBe(requests);
});
