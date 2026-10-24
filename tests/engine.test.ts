import { describe, it, expect, vi } from 'vitest';
import { editDocument, type Progress } from '../src/core/engine';
import { autoLocks } from '../src/core/protection';
import { DEFAULT_LOCKS, type Connection } from '../src/core/types';
import type { complete } from '../src/core/api';
const connection: Connection = { url: 'http://localhost:1234/v1', model: 'test', key: '', temperature: 0.3, maxTokens: 4096 };
const source = '# Title\n\nThis clearly explains the allocation of 42 ports and the relevant failure mode.\n\nThe second paragraph makes a useful point about connection limits.\n';
describe('checked editing', () => {
  it('retries a damaged lock, then accepts a correct second attempt', async () => {
    let attempt = 0;
    const generate: typeof complete = vi.fn(async (_c, _system, text, _signal, onText) => {
      attempt++;
      const result = attempt === 1 ? text.replace(/\[\[ET_[^\]]+\]\]/, 'wrong') : text.replace('clearly', 'precisely');
      onText(result); return result;
    });
    const result = await editDocument(source, autoLocks(source, 'markdown', DEFAULT_LOCKS), connection, 'Light edit.', new AbortController().signal, () => {}, generate);
    expect(generate).toHaveBeenCalledTimes(3);
    expect(result.text).toContain('42 ports'); expect(result.text).toContain('precisely');
    expect(result.issues).toHaveLength(0); expect(result.text.startsWith('# Title\n\n')).toBe(true);
  });
  it('retains only the failed original passage after one retry', async () => {
    const generate: typeof complete = vi.fn(async (_c, _system, text) => text.includes('ET_') ? text.replace(/\[\[ET_[^\]]+\]\]/g, '') : text.replace('useful', 'helpful'));
    const result = await editDocument(source, autoLocks(source, 'markdown', DEFAULT_LOCKS), connection, '', new AbortController().signal, () => {}, generate);
    expect(result.issues).toHaveLength(1); expect(result.text).toContain('42 ports');
    expect(result.text).toContain('helpful point'); expect(result.issues[0].message).toContain('Original kept');
  });
  it('keeps exact CRLF and line markers', async () => {
    const text = '- First helpful item\r\n- Second helpful item\r\n\r\nFinal sentence.';
    const generate: typeof complete = async (_c, _s, input) => input.replaceAll('helpful', 'useful');
    const result = await editDocument(text, autoLocks(text, 'markdown', DEFAULT_LOCKS), connection, '', new AbortController().signal, () => {}, generate);
    expect(result.text).toBe(text.replaceAll('helpful', 'useful'));
  });
  it('keeps whitespace at chunk boundaries even if a model trims it', async () => {
    const text = 'This paragraph is deliberately long. '.repeat(130);
    const generate: typeof complete = async (_c, _s, input) => input.trim();
    const result = await editDocument(text, [], connection, '', new AbortController().signal, () => {}, generate);
    expect(result.text).toBe(text);
  });
  it('rolls back an in-flight passage when cancelled', async () => {
    const controller = new AbortController(); let last: Progress | undefined;
    const generate: typeof complete = async (_c, _s, _input, signal, onText) => { onText('Provisional text.'); controller.abort(); signal.throwIfAborted(); return ''; };
    await expect(editDocument(source, [], connection, '', controller.signal, p => { last = p; }, generate)).rejects.toThrow();
    expect(last?.text).toBe(source);
  });
  it('stops after network failure and leaves the full source in place', async () => {
    let last: Progress | undefined;
    const generate: typeof complete = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    await expect(editDocument(source, [], connection, '', new AbortController().signal, p => { last = p; }, generate)).rejects.toThrow();
    expect(generate).toHaveBeenCalledTimes(1); expect(last?.text).toBe(source);
  });
  it('rejects new paragraph breaks and severe shortening', async () => {
    const generate: typeof complete = async () => 'Summary.\n\nNew paragraph.';
    const result = await editDocument(source, autoLocks(source, 'markdown', DEFAULT_LOCKS), connection, '', new AbortController().signal, () => {}, generate);
    expect(result.text).toBe(source); expect(result.issues).toHaveLength(2);
  });
});
