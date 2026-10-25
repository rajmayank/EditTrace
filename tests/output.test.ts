import { describe, expect, it } from 'vitest';
import { clipOutputLocks, joinOutputLocks, originalOutputLocks, resolveOutputLocks } from '../src/core/output';
import { autoLocks, protect, restoredStream } from '../src/core/protection';
import { editDocument, retryPassage, type Progress } from '../src/core/engine';
import { DEFAULT_LOCKS, type Connection, type OutputLock } from '../src/core/types';

const connection: Connection = { url: 'http://localhost:1234/v1', model: 'test', key: '', temperature: .3, maxTokens: 4096 };
const assertLiteral = (source: string, text: string, locks: OutputLock[]) => {
  for (const lock of locks) expect(text.slice(lock.from, lock.to)).toBe(source.slice(lock.sourceFrom, lock.sourceTo));
};

describe('result protections', () => {
  it('recovers older drafts only when the ordered lock placement is unambiguous', () => {
    const source = 'first fact\n\nsecond fact', output = 'clearer fact\n\nsecond fact';
    const locks = autoLocks(source, 'text', DEFAULT_LOCKS, [{ from: source.indexOf('second'), to: source.length }]);
    const recovered = resolveOutputLocks(source, output, locks);
    expect(recovered.complete).toBe(true); assertLiteral(source, output, recovered.locks);
    expect(resolveOutputLocks('fact fact', 'fact fact fact', [{ from: 0, to: 4, kind: 'Fact' }])).toEqual({ locks: [], complete: false });
    expect(resolveOutputLocks('fact fact', 'fact fact', [{ from: 0, to: 4, kind: 'Fact' }]).locks[0].from).toBe(0);
  });

  it('rejects stale, missing, reordered, or fabricated saved ranges', () => {
    const source = 'one two', locks = [{ from: 0, to: 3, kind: 'Fact' }, { from: 4, to: 7, kind: 'Fact' }];
    const saved = originalOutputLocks(locks);
    expect(resolveOutputLocks(source, source, locks, saved).complete).toBe(true);
    for (const invalid of [[], saved.slice(1), [{ ...saved[0], to: 99 }], [{ ...saved[0], sourceTo: 7 }]]) expect(resolveOutputLocks(source, source, locks, invalid).complete).toBe(false);
    expect(resolveOutputLocks(source, 'two one', locks, [{ ...saved[1], from: 0, to: 3 }, { ...saved[0], from: 4, to: 7 }]).complete).toBe(false);
  });

  it('clips and rejoins protections crossing passage boundaries without losing source provenance', () => {
    const lock: OutputLock = { from: 5, to: 15, sourceFrom: 20, sourceTo: 30, kind: 'Fact' };
    expect(clipOutputLocks([lock], 8, 12, 4)).toEqual([{ ...lock, from: 12, to: 16, sourceFrom: 23, sourceTo: 27 }]);
    expect(joinOutputLocks([...clipOutputLocks([lock], 0, 10), ...clipOutputLocks([lock], 10, 20)])).toEqual([lock]);
  });

  it('tracks the exact emitted marker occurrence when unprotected prose repeats the same fact', async () => {
    const source = 'The client sees a client.', at = source.lastIndexOf('client');
    const locks = [{ from: at, to: at + 6, kind: 'Fact' }];
    const seen: Progress[] = [];
    const result = await editDocument(source, locks, connection, '', new AbortController().signal, p => seen.push(p), async (_c, _s, input, _signal, onText) => {
      const text = 'A client and ' + input.replace('The client sees a ', ''); onText(text); return text;
    });
    expect(result.text).toBe('A client and client.');
    expect(result.outputLocks).toEqual([{ ...locks[0], from: 13, to: 19, sourceFrom: at, sourceTo: at + 6 }]);
    assertLiteral(source, result.text, result.outputLocks);
    for (const p of seen) assertLiteral(source, p.text, p.outputLocks);
  });

  it('keeps marker-like text inside protected content literal while hiding incomplete stream markers', () => {
    const source = 'Keep [[ET_example]] literally.';
    const p = protect(source, [{ from: 5, to: 19, kind: 'Fact' }]);
    expect(restoredStream(p.text, p).text).toBe(source);
    expect(restoredStream('Before [[ET_unfinished', p)).toEqual({ text: 'Before ', locks: [] });
  });

  it('retains protection coordinates across retries, kept passages, and CRLF code blocks', async () => {
    const source = '# Header\r\n\r\nFIRST_FAIL keeps 42 items.\r\n\r\n```sh\r\nss -s\r\n\r\n```\r\n';
    const locks = autoLocks(source, 'markdown', DEFAULT_LOCKS);
    const first = await editDocument(source, locks, connection, '', new AbortController().signal, () => {}, async (_c, _s, input) => input.includes('FIRST_FAIL') ? input + '<p>' : input.replace('Header', 'A clearer header'));
    expect(first.issues).toHaveLength(1);
    expect(resolveOutputLocks(source, first.text, locks, first.outputLocks).complete).toBe(true);
    const fixed = await retryPassage(source, first.text, locks, first.issues, first.issues[0], connection, '', new AbortController().signal, p => assertLiteral(source, p.text, p.outputLocks), async (_c, _s, input, _signal, onText) => { const text = input.replace('FIRST_FAIL', 'A repaired passage'); onText(text); return text; }, first.outputLocks);
    expect(fixed.issues).toHaveLength(0);
    expect(resolveOutputLocks(source, fixed.text, locks, fixed.outputLocks).complete).toBe(true);
    assertLiteral(source, fixed.text, fixed.outputLocks);
  });

  it('rolls back both output text and its protections when a scoped retry is cancelled', async () => {
    const source = 'An accepted paragraph.\n\nRETAIN 42 facts.\n\nA final fact.';
    const locks = autoLocks(source, 'markdown', DEFAULT_LOCKS);
    const first = await editDocument(source, locks, connection, '', new AbortController().signal, () => {}, async (_c, _s, input) => input.includes('RETAIN') ? input + '<p>' : input);
    const controller = new AbortController();
    const seen: { text: string; outputLocks: OutputLock[] }[] = [];
    await expect(retryPassage(source, first.text, locks, first.issues, first.issues[0], connection, '', controller.signal, p => { seen.push(p); assertLiteral(source, p.text, p.outputLocks); }, async (_c, _s, input, signal, onText) => {
      onText(input.replace('RETAIN', 'A repaired and expanded passage'));
      controller.abort(); signal.throwIfAborted(); return input;
    }, first.outputLocks)).rejects.toThrow();
    expect(seen.at(-1)?.text).toBe(first.text);
    expect(seen.at(-1)?.outputLocks).toEqual(first.outputLocks);
  });
});
