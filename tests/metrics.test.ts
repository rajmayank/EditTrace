import { describe, expect, it, vi } from 'vitest';
import { GenerationMeter, generatedWordCount, outputWordsPerMinute } from '../src/core/metrics';
import { estimateReading } from '../src/core/reading';
import { editDocument } from '../src/core/engine';
import { autoLocks } from '../src/core/protection';
import { DEFAULT_LOCKS, type Connection } from '../src/core/types';

describe('document and model metrics', () => {
  it('estimates reading time using 200 words per minute', () => {
    for (const [words, minutes] of [[0, 0], [182, 1], [200, 1], [201, 2], [2400, 12]]) expect(estimateReading('word '.repeat(words), 'text').minutes).toBe(minutes);
  });
  it('excludes complete and partially streamed protected markers', () => {
    expect(generatedWordCount('Hello [[ET_test_0]] world')).toBe(2);
    for (const suffix of ['[', '[[', '[[E', '[[ET', '[[ET_', '[[ET_test_0', '[[ET_test_0]']) expect(generatedWordCount('Hello ' + suffix)).toBe(1);
    expect(generatedWordCount('Hello <p>world</p>')).toBe(2);
  });
  it('counts each cumulative stream once and includes the work of retries', () => {
    let time = 0;
    const meter = new GenerationMeter(() => time);
    meter.beginAttempt(); meter.observe('one two'); meter.observe('one two three');
    time = 1000;
    expect(meter.snapshot()).toEqual({ words: 3, elapsedMs: 1000 });
    meter.beginAttempt(); meter.observe('try again');
    time = 2000;
    expect(meter.snapshot()).toEqual({ words: 5, elapsedMs: 2000 });
    expect(outputWordsPerMinute(meter.snapshot())).toBe(150);
    expect(outputWordsPerMinute({ words: 0, elapsedMs: 1000 })).toBeNull();
    expect(outputWordsPerMinute({ words: 20, elapsedMs: 0 })).toBeNull();
  });
  it('measures model text without counting restored facts or the original fallback', async () => {
    let time = 0, attempt = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => time);
    const connection: Connection = { url: 'http://localhost:1234/v1', model: 'test', key: '', temperature: .3, maxTokens: 4096 };
    const source = 'Original with 42 ports.';
    const result = await editDocument(source, autoLocks(source, 'markdown', DEFAULT_LOCKS), connection, '', new AbortController().signal, () => {}, async (_c, _s, input, _signal, onText) => {
      time += 1000;
      const text = ++attempt === 1 ? input + '<p>' : input.replace('Original', 'Revised');
      onText(text); return text;
    });
    expect(result.text).toBe('Revised with 42 ports.');
    expect(result.stats).toEqual({ words: 6, elapsedMs: 2000 });
    expect(outputWordsPerMinute(result.stats)).toBe(180);
    const protectedResult = await editDocument('42', autoLocks('42', 'text', DEFAULT_LOCKS), connection, '', new AbortController().signal, () => {}, vi.fn());
    expect(protectedResult.stats.words).toBe(0);
    expect(outputWordsPerMinute(protectedResult.stats)).toBeNull();
  });
});
