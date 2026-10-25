import type { Page } from '@playwright/test';
import { test, expect, connect } from './fixtures';

const documents = () => {
  const sections = (edited: boolean) => Array.from({ length: 20 }, (_, i) => `## Section ${i + 1}\n\nPassage ${i + 1}. ` +
    (edited ? 'Revised wording keeps the argument clear. ' : 'Original wording explains the argument in detail. ').repeat(edited ? i % 2 ? 32 : 6 : 18)).join('\n\n');
  return { source: sections(false), output: sections(true) };
};

async function openDraft(page: Page, partial = false) {
  const { source, output } = documents();
  await page.addInitScript(({ source, output }) => {
    if (localStorage.getItem('edittrace.v1.settings')) return;
    localStorage.setItem('edittrace.v1.settings', JSON.stringify({ saveDrafts: true, connectionEnabled: false }));
    localStorage.setItem('edittrace.v1.draft', JSON.stringify({ source, output, manual: [], format: 'markdown', name: 'Scroll alignment.md' }));
  }, { source, output: partial ? output.split('\n\n').slice(0, 6).join('\n\n') : output });
  await page.goto('/');
  await expect(page.locator('.result-panel .cm-scroller')).toBeAttached();
}

const scroller = (page: Page, pane: 'draft' | 'result', preview = false) => page.locator(`.${pane}-panel ${preview ? '.markdown-preview' : '.cm-scroller'}`);

async function visibleBlock(page: Page, pane: 'draft' | 'result', preview = false) {
  return scroller(page, pane, preview).evaluate(element => {
    const top = element.getBoundingClientRect().top;
    const nodes = element.querySelectorAll(element.classList.contains('cm-scroller') ? '.cm-line' : 'h1,h2,h3,p,pre,ul,ol,table,blockquote');
    for (const node of nodes) {
      const rect = node.getBoundingClientRect();
      const match = node.textContent?.match(/(Section|Passage) (\d+)/);
      if (match && rect.bottom > top + 2) return { block: match[0], fraction: Math.max(0, (top - rect.top) / rect.height) };
    }
    return { block: '', fraction: 0 };
  });
}

async function expectAligned(page: Page, originalPreview = false, editedPreview = false) {
  await expect.poll(async () => {
    const a = await visibleBlock(page, 'draft', originalPreview), b = await visibleBlock(page, 'result', editedPreview);
    return a.block === b.block && Math.abs(a.fraction - b.fraction) < .15;
  }).toBe(true);
}

test('both editors align rewritten blocks, retain focus, and can scroll independently', async ({ page }, info) => {
  await openDraft(page);
  const original = scroller(page, 'draft'), edited = scroller(page, 'result');
  const toggle = page.getByRole('button', { name: 'Link scrolling' });
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('textbox', { name: 'Original draft' }).focus();
  await original.hover(); await page.mouse.wheel(0, 1850);
  await expect.poll(() => original.evaluate(el => el.scrollTop)).toBeGreaterThan(1000);
  await expectAligned(page);
  await expect(page.getByRole('textbox', { name: 'Original draft' })).toBeFocused();
  const tops = await Promise.all([original.evaluate(el => el.scrollTop), edited.evaluate(el => el.scrollTop)]);
  expect(Math.abs(tops[0] - tops[1])).toBeGreaterThan(100);
  await edited.hover(); await page.mouse.wheel(0, 1350);
  await expect.poll(() => edited.evaluate(el => el.scrollTop)).toBeGreaterThan(tops[1] + 500);
  await expectAligned(page);
  await page.screenshot({ path: info.outputPath('linked-scroll-light.png'), fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Toggle theme' }).click();
  await page.screenshot({ path: info.outputPath('linked-scroll-dark.png'), fullPage: true, animations: 'disabled' });
  await toggle.click();
  const before = await edited.evaluate(el => el.scrollTop);
  await original.hover(); await page.mouse.wheel(0, 900);
  await expect.poll(() => original.evaluate(el => el.scrollTop)).toBeGreaterThan(tops[0] + 900);
  await expect(edited).toHaveJSProperty('scrollTop', before);
  await toggle.click();
  await expectAligned(page);
  await toggle.click();
  await page.reload();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await original.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await expect.poll(() => edited.evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThan(2);
  await edited.evaluate(el => { el.scrollTop = 0; });
  await expect.poll(() => original.evaluate(el => el.scrollTop)).toBeLessThan(3);
});

test('source, Markdown preview, and reading view share the same block alignment', async ({ page }) => {
  await openDraft(page);
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  const preview = scroller(page, 'draft', true);
  await preview.hover(); await page.mouse.wheel(0, 1600);
  await expect.poll(() => preview.evaluate(el => el.scrollTop)).toBeGreaterThan(1000);
  await expectAligned(page, true, false);
  await page.getByRole('button', { name: 'Read', exact: true }).click();
  await expectAligned(page, true, true);
  const reading = scroller(page, 'result', true);
  await reading.hover(); await page.mouse.wheel(0, 2300);
  await expect.poll(() => reading.evaluate(el => el.scrollTop)).toBeGreaterThan(1500);
  await expectAligned(page, true, true);
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await expectAligned(page, false, true);
  await reading.hover(); await page.mouse.wheel(0, 900);
  await expectAligned(page, false, true);
});

test('an unfinished result clamps at received content without inserting future passages', async ({ page }) => {
  await openDraft(page, true);
  const original = scroller(page, 'draft'), edited = scroller(page, 'result');
  await original.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await expect.poll(() => edited.evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThan(2);
  await expect(page.getByRole('textbox', { name: 'Edited result' })).not.toContainText('Passage 4.');
  await edited.evaluate(el => { el.scrollTop = 0; });
  await expect.poll(() => original.evaluate(el => el.scrollTop)).toBeLessThan(3);
});

test('mobile scrolling leaves the hidden pane and page position alone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openDraft(page);
  const original = scroller(page, 'draft'), edited = scroller(page, 'result');
  const pageTop = await page.evaluate(() => scrollY);
  await original.evaluate(el => { el.scrollTop = 700; });
  await expect(original).toHaveJSProperty('scrollTop', 700);
  await expect(edited).toHaveJSProperty('scrollTop', 0);
  expect(await page.evaluate(() => scrollY)).toBe(pageTop);
  await page.getByRole('group', { name: 'Editor panel' }).getByRole('button', { name: 'Edited' }).click();
  const hiddenTop = await original.evaluate(el => el.scrollTop);
  await edited.evaluate(el => { el.scrollTop = 500; });
  await expect(edited).toHaveJSProperty('scrollTop', 500);
  await expect(original).toHaveJSProperty('scrollTop', hiddenTop);
});

test('linked scrolling remains usable while output streams without revealing later passages', async ({ page, modelServer }) => {
  modelServer.control.tokenInterval = 24;
  const source = Array.from({ length: 6 }, (_, i) => `Passage ${i + 1}. ` + 'A technical explanation keeps its detail while the prose is edited. '.repeat(18)).join('\n\n');
  await page.goto('/');
  await connect(page, modelServer.url);
  await page.locator('input[type=file]').setInputFiles({ name: 'Streaming.md', mimeType: 'text/markdown', buffer: Buffer.from(source) });
  await page.getByRole('button', { name: 'Edit draft' }).click();
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
  const result = page.getByRole('textbox', { name: 'Edited result' });
  await expect(result).toContainText('Passage 2.', { timeout: 15000 });
  await scroller(page, 'draft').evaluate(el => { el.scrollTop = el.scrollHeight; });
  await expect.poll(() => scroller(page, 'result').evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  await expect(result).not.toContainText('Passage 6.');
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.getByText('Stopped. Unfinished passages kept original.')).toBeVisible();
});
