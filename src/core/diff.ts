import { diffWordsWithSpace } from 'diff';
import type { OutputLock, Span } from './types';

export type DocumentDiff = { before: Span[]; after: Span[] };

/** A bounded search can group a replacement, but must never hide it. */
function groupedDiff(before: string, after: string): DocumentDiff {
  let start = 0, a = before.length, b = after.length;
  while (start < a && start < b && before[start] === after[start]) start++;
  while (a > start && b > start && before[a - 1] === after[b - 1]) { a--; b--; }
  const high = (n: number) => n >= 0xd800 && n <= 0xdbff;
  const low = (n: number) => n >= 0xdc00 && n <= 0xdfff;
  // Keep UTF-16 ranges on complete characters, including emoji.
  if (low(before.charCodeAt(start)) && high(before.charCodeAt(start - 1))) start--;
  if (low(before.charCodeAt(a)) && high(before.charCodeAt(a - 1))) { a++; b++; }
  return { before: a > start ? [{ from: start, to: a }] : [], after: b > start ? [{ from: start, to: b }] : [] };
}

/** Compare between verified locks and reuse unchanged passage comparisons while typing. */
export function createDocumentDiffer() {
  let previous = new Map<string, Map<string, DocumentDiff>>();
  return (source: string, output: string, locks: OutputLock[] = []): DocumentDiff => {
    const before: Span[] = [], after: Span[] = [];
    const current = new Map<string, Map<string, DocumentDiff>>();
    const deadline = Date.now() + 120;
    function compare(a: number, endA: number, b: number, endB: number) {
      const original = source.slice(a, endA), edited = output.slice(b, endB);
      if (original === edited) return;
      let diff = current.get(original)?.get(edited) ?? previous.get(original)?.get(edited);
      if (!diff) {
        const remaining = deadline - Date.now();
        const changes = remaining > 0 ? diffWordsWithSpace(original, edited, { timeout: Math.min(25, remaining), maxEditLength: 1000 }) : undefined;
        diff = { before: [], after: [] };
        if (changes) {
          let from = 0, to = 0;
          for (const change of changes) {
            if (change.removed) { diff.before.push({ from, to: from + change.value.length }); from += change.value.length; }
            else if (change.added) { diff.after.push({ from: to, to: to + change.value.length }); to += change.value.length; }
            else { from += change.value.length; to += change.value.length; }
          }
        } else diff = groupedDiff(original, edited);
      }
      if (!current.has(original)) current.set(original, new Map());
      current.get(original)!.set(edited, diff);
      before.push(...diff.before.map(range => ({ from: a + range.from, to: a + range.to })));
      after.push(...diff.after.map(range => ({ from: b + range.from, to: b + range.to })));
    }
    let a = 0, b = 0;
    for (const lock of locks) {
      if (![lock.sourceFrom, lock.sourceTo, lock.from, lock.to].every(Number.isSafeInteger) ||
        lock.sourceFrom < a || lock.sourceTo <= lock.sourceFrom || lock.sourceTo > source.length ||
        lock.from < b || lock.to <= lock.from || lock.to > output.length ||
        source.slice(lock.sourceFrom, lock.sourceTo) !== output.slice(lock.from, lock.to)) continue;
      compare(a, lock.sourceFrom, b, lock.from);
      a = lock.sourceTo; b = lock.to;
    }
    compare(a, source.length, b, output.length);
    // Retain only the current document's comparisons, rather than an edit history.
    previous = current;
    return { before, after };
  };
}
