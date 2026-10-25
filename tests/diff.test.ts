import { describe, expect, it } from 'vitest';
import { createDocumentDiffer } from '../src/core/diff';
import type { OutputLock, Span } from '../src/core/types';

const marked = (text: string, ranges: Span[]) => ranges.map(range => text.slice(range.from, range.to));
function lineLocks(source: string, output: string): OutputLock[] {
  const original = [...source.matchAll(/\r\n|\n/g)], edited = [...output.matchAll(/\r\n|\n/g)];
  return original.map((match, i) => ({ sourceFrom: match.index, sourceTo: match.index + match[0].length,
    from: edited[i].index, to: edited[i].index + edited[i][0].length, kind: 'Line break' }));
}

describe('document comparison', () => {
  it('keeps precise word changes throughout a long article with protected structure', () => {
    const source = Array.from({ length: 120 }, (_, i) => `Passage ${i}: A concrete trace explains the client connection and its limits.`).join('\n\n');
    const output = source.replaceAll('concrete', 'specific').replaceAll('client', 'application');
    const result = createDocumentDiffer()(source, output, lineLocks(source, output));
    expect(marked(source, result.before)).toEqual(Array.from({ length: 120 }, () => ['concrete', 'client']).flat());
    expect(marked(output, result.after)).toEqual(Array.from({ length: 120 }, () => ['specific', 'application']).flat());
  });

  it('updates local prose changes and undo without moving a repeated protected fact', () => {
    const compare = createDocumentDiffer();
    const source = 'A client and another client.\n\nA final paragraph.';
    const output = 'An application and another client.\n\nA final paragraph.';
    const fact = source.lastIndexOf('client'), at = output.lastIndexOf('client');
    const locks = [...lineLocks(source, output), { sourceFrom: fact, sourceTo: fact + 6, from: at, to: at + 6, kind: 'Fact' }].sort((a, b) => a.from - b.from);
    const first = compare(source, output, locks);
    const local = output.replace('A final paragraph', 'An expanded closing paragraph');
    const updated = compare(source, local, locks);
    expect(marked(local, updated.after).join(' ')).toContain('expanded closing');
    expect(updated.after.some(r => r.from < at + 6 && r.to > at)).toBe(false);
    expect(updated).toEqual(createDocumentDiffer()(source, local, locks));
    expect(compare(source, output, locks)).toEqual(first);
  });

  it('retains visible replacements when a large unprotected rewrite exceeds the word search', () => {
    const prefix = 'Shared start.\n\n', suffix = '\n\nShared finish.';
    const source = prefix + Array.from({ length: 5000 }, (_, i) => `alpha${i}left`).join(' ') + suffix;
    const output = prefix + Array.from({ length: 5000 }, (_, i) => `beta${i}right`).join(' ') + suffix;
    const result = createDocumentDiffer()(source, output);
    for (const [text, ranges, first, last] of [[source, result.before, 'alpha0', 'alpha4999'], [output, result.after, 'beta0', 'beta4999']] as const) {
      expect(ranges.some(r => r.from <= text.indexOf(first) && r.to > text.indexOf(first))).toBe(true);
      expect(ranges.some(r => r.from <= text.indexOf(last) && r.to > text.indexOf(last))).toBe(true);
      expect(ranges.every(r => r.from >= prefix.length && r.to <= text.length - suffix.length)).toBe(true);
    }
  });

  it('preserves raw CRLF offsets, insertions, deletions, and complete Unicode characters', () => {
    const compare = createDocumentDiffer();
    const source = 'Old heading\r\n\r\nA clear idea. 😀\r\n';
    const output = 'New heading\r\n\r\nA clearer idea. 😁\r\n';
    const result = compare(source, output, lineLocks(source, output));
    expect(marked(source, result.before)).toEqual(['Old', 'clear', '😀']);
    expect(marked(output, result.after)).toEqual(['New', 'clearer', '😁']);
    expect(compare('Original', '')).toEqual({ before: [{ from: 0, to: 8 }], after: [] });
    expect(compare('', 'Added')).toEqual({ before: [], after: [{ from: 0, to: 5 }] });
    expect(compare('Same', 'Same')).toEqual({ before: [], after: [] });
  });

  it('does not let invalid anchor coordinates hide a replacement', () => {
    const result = createDocumentDiffer()('A client.', 'An application.', [{ sourceFrom: 0, sourceTo: 9, from: 0, to: 15, kind: 'Invalid' }]);
    expect(marked('A client.', result.before).join(' ')).toContain('client');
    expect(marked('An application.', result.after).join(' ')).toContain('application');
  });
});
