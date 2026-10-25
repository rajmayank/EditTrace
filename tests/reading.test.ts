import { describe, expect, it, vi } from 'vitest';
import { estimateReading } from '../src/core/reading';

describe('Markdown-aware reading estimates', () => {
  it('counts readable headings and link labels without Markdown markers or destinations', () => {
    const text = '# A helpful heading\n\nRead **these words** and [the guide](https://example.com/a/very/long/path).\n\n- First item\n- Second item\n';
    const reading = estimateReading(text, 'markdown');
    expect(reading.words).toBe(13);
    expect(reading.codeWords).toBe(0);
    expect(reading.timeMs).toBe(3900);
  });
  it('excludes front matter, comments, and hidden HTML', () => {
    const text = '---\ntitle: hidden metadata with many words\n---\n\nVisible prose.\n\n<!-- hidden comment -->\n<script>hidden script words</script>\n';
    expect(estimateReading(text, 'markdown').words).toBe(2);
  });
  it('allows extra time for fenced and inline code, including an unfinished fence', () => {
    const code = '```js\n' + 'value '.repeat(150);
    const reading = estimateReading(code, 'markdown');
    expect(reading.codeWords).toBe(150);
    expect(reading.minutes).toBe(2);
    expect(estimateReading('value '.repeat(150), 'text').minutes).toBe(1);
    expect(estimateReading('Run `ss -s` now.', 'markdown').codeWords).toBe(2);
  });
  it('adds an image allowance without fetching images or other URLs', () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const reading = estimateReading('![one](https://example.com/one.png)\n\n![two](https://example.com/two.png)', 'markdown');
    expect(reading.images).toBe(2);
    expect(reading.words).toBe(2);
    expect(reading.timeMs).toBe(23600);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('keeps table text and supports text without spaces', () => {
    expect(estimateReading('Name | Value\n--- | ---\nPort | Fast\n', 'markdown').words).toBe(4);
    expect(estimateReading('你好世界', 'text').words).toBe(4);
  });
  it('recomputes counts and estimates for growing, partially streamed Markdown', () => {
    const first = estimateReading('# Title\n\n' + 'detail '.repeat(20) + '[guide](', 'markdown');
    const later = estimateReading('# Title\n\n' + 'detail '.repeat(220) + '[guide](https://example.com)', 'markdown');
    expect(later.words).toBeGreaterThan(first.words);
    expect(first.minutes).toBe(1);
    expect(later.minutes).toBe(2);
  });
});
