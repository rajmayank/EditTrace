import { describe, expect, it, vi } from 'vitest';
import { editDocument, PassageStateError, retryPassage, type PassageProgress } from '../src/core/engine';
import { autoLocks } from '../src/core/protection';
import { DEFAULT_LOCKS, type Connection } from '../src/core/types';
import type { complete } from '../src/core/api';

const connection: Connection = { url: 'http://localhost:1234/v1', model: 'test', key: '', temperature: .3, maxTokens: 4096 };
const source = 'A concrete trace explains the first step.\n\nFIRST_FAIL keeps the exact limit of 42 ports.\n\nSECOND_FAIL keeps a separate limit of 64 ports.\n\nThe final approved paragraph stays useful.\n';
const fact = source.indexOf('exact limit');
const locks = autoLocks(source, 'markdown', DEFAULT_LOCKS, [{ from: fact, to: fact + 'exact limit'.length }]);
async function failedDocument() {
  return editDocument(source, locks, connection, '', new AbortController().signal, () => {}, async (_c, _s, input) => input.includes('_FAIL') ? input + '<p>' : input.replace('concrete', 'specific and practical'));
}

describe('retrying a retained passage', () => {
  it('submits only the chosen original passage, masks its facts, and shifts later review targets', async () => {
    // Numeric marker IDs are not leaked passage content.
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('42000000-6400-4000-8000-000000000000');
    const original = await failedDocument(), target = original.issues[0];
    const seen: PassageProgress[] = [];
    const generate: typeof complete = vi.fn(async (_c, system, input, _signal, onText) => {
      expect(system).toContain('New editing instructions');
      expect(input).toContain('FIRST_FAIL');
      const visibleInput = input.replace(/\[\[ET_[^\]]+\]\]/g, '');
      for (const excluded of ['SECOND_FAIL', 'concrete', 'final approved', '42', 'exact limit']) expect(visibleInput).not.toContain(excluded);
      const text = input.replace('FIRST_FAIL', 'The recovered first passage');
      onText(text.slice(0, 16)); onText(text); return text;
    });
    const result = await retryPassage(source, original.text, locks, original.issues, target, connection, 'New editing instructions', new AbortController().signal, p => seen.push(p), generate);
    const prefix = original.text.slice(0, target.outputFrom), suffix = original.text.slice(target.outputTo);
    const replacement = source.slice(target.from, target.to).replace('FIRST_FAIL', 'The recovered first passage');
    expect(result.text).toBe(prefix + replacement + suffix);
    expect(generate).toHaveBeenCalledTimes(1);
    for (const p of seen) { expect(p.text.startsWith(prefix)).toBe(true); expect(p.text.endsWith(suffix)).toBe(true); }
    expect(result.issues).toHaveLength(1);
    const remaining = result.issues[0];
    expect(remaining.from).toBe(original.issues[1].from);
    expect(remaining.outputFrom).toBe(original.issues[1].outputFrom + replacement.length - (target.outputTo - target.outputFrom));
    expect(result.text.slice(remaining.outputFrom, remaining.outputTo)).toBe(source.slice(remaining.from, remaining.to));
    const second = await retryPassage(source, result.text, locks, result.issues, remaining, connection, '', new AbortController().signal, () => {}, async (_c, _s, input) => input.replace('SECOND_FAIL', 'The recovered second passage'));
    expect(second.issues).toHaveLength(0);
    expect(second.text).toBe(result.text.replace('SECOND_FAIL', 'The recovered second passage'));
  });
  it.each(['markers', 'html'])('retains the previous result and flag if %s protection still fails', async failure => {
    const original = await failedDocument();
    const generate: typeof complete = vi.fn(async (_c, _s, input, _signal, onText) => {
      const text = failure === 'markers' ? input.replace(/\[\[ET_[^\]]+\]\]/g, '') : input + '<div>';
      onText(text); return text;
    });
    const result = await retryPassage(source, original.text, locks, original.issues, original.issues[0], connection, '', new AbortController().signal, () => {}, generate);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(result.text).toBe(original.text);
    expect(result.issues).toHaveLength(2);
    expect(result.issues[1]).toEqual(original.issues[1]);
    expect(result.issues[0].message).toContain(failure === 'markers' ? 'Protected text changed' : 'Unexpected HTML');
  });
  it.each(['cancel', 'network'])('rolls back partial retry output after %s', async failure => {
    const original = await failedDocument(), controller = new AbortController();
    let last: PassageProgress | undefined;
    const generate: typeof complete = vi.fn(async (_c, _s, _input, signal, onText) => {
      onText('A provisional replacement');
      if (failure === 'cancel') { controller.abort(); signal.throwIfAborted(); }
      throw new TypeError('Failed to fetch');
    });
    await expect(retryPassage(source, original.text, locks, original.issues, original.issues[0], connection, '', controller.signal, p => { last = p; }, generate)).rejects.toThrow();
    expect(generate).toHaveBeenCalledTimes(1);
    expect(last?.text).toBe(original.text); expect(last?.issues).toEqual(original.issues);
  });
  it('rejects stale or unflagged ranges before contacting the model', async () => {
    const original = await failedDocument(), generate: typeof complete = vi.fn();
    const stale = { ...original.issues[0], outputFrom: original.issues[0].outputFrom + 1 };
    await expect(retryPassage(source, original.text, locks, original.issues, stale, connection, '', new AbortController().signal, () => {}, generate)).rejects.toBeInstanceOf(PassageStateError);
    await expect(retryPassage(source.replace('FIRST_FAIL', 'EDITED_NOW'), original.text, locks, original.issues, original.issues[0], connection, '', new AbortController().signal, () => {}, generate)).rejects.toBeInstanceOf(PassageStateError);
    expect(generate).not.toHaveBeenCalled();
  });
});
