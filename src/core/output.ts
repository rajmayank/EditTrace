import type { Lock, OutputLock, Span } from './types';

export function joinOutputLocks(ranges: OutputLock[]): OutputLock[] {
  const result: OutputLock[] = [];
  for (const range of [...ranges].sort((a, b) => a.from - b.from)) {
    const last = result.at(-1);
    if (last && last.to === range.from && last.sourceTo === range.sourceFrom && last.kind === range.kind) {
      last.to = range.to; last.sourceTo = range.sourceTo;
    } else result.push({ ...range });
  }
  return result;
}

export const originalOutputLocks = (locks: Lock[], sourceBase = 0, outputBase = 0): OutputLock[] => locks.map(lock => ({
  ...lock, from: outputBase + lock.from, to: outputBase + lock.to,
  sourceFrom: sourceBase + lock.from, sourceTo: sourceBase + lock.to,
}));

export function clipOutputLocks(locks: OutputLock[], from: number, to: number, shift = 0): OutputLock[] {
  return locks.flatMap(lock => {
    const a = Math.max(from, lock.from), b = Math.min(to, lock.to);
    return b > a ? [{ ...lock, from: a + shift, to: b + shift, sourceFrom: lock.sourceFrom + a - lock.from, sourceTo: lock.sourceFrom + b - lock.from }] : [];
  });
}

function coverage(ranges: Span[]): Span[] {
  const result: Span[] = [];
  for (const range of [...ranges].sort((a, b) => a.from - b.from)) {
    const last = result.at(-1);
    if (last && range.from <= last.to) last.to = Math.max(last.to, range.to);
    else result.push({ from: range.from, to: range.to });
  }
  return result;
}

/** Recover older drafts only when the entire ordered protection sequence has one placement. */
export function resolveOutputLocks(source: string, output: string, locks: Lock[], saved?: OutputLock[]): { locks: OutputLock[]; complete: boolean } {
  if (!locks.length) return { locks: [], complete: true };
  if (saved !== undefined) {
    const valid = Array.isArray(saved) ? saved.filter(lock => lock &&
      [lock.from, lock.to, lock.sourceFrom, lock.sourceTo].every(Number.isSafeInteger) && typeof lock.kind === 'string' &&
      lock.from >= 0 && lock.to > lock.from && lock.to <= output.length &&
      lock.sourceFrom >= 0 && lock.sourceTo > lock.sourceFrom && lock.sourceTo <= source.length &&
      lock.to - lock.from === lock.sourceTo - lock.sourceFrom &&
      output.slice(lock.from, lock.to) === source.slice(lock.sourceFrom, lock.sourceTo)
    ).sort((a, b) => a.from - b.from) : [];
    const ordered = valid.every((lock, i) => !i || valid[i - 1].to <= lock.from && valid[i - 1].sourceTo <= lock.sourceFrom);
    const expected = coverage(locks), actual = coverage(valid.map(lock => ({ from: lock.sourceFrom, to: lock.sourceTo })));
    const complete = Array.isArray(saved) && valid.length === saved.length && ordered && JSON.stringify(expected) === JSON.stringify(actual);
    return { locks: valid, complete };
  }
  if (source === output) return { locks: originalOutputLocks(locks), complete: true };
  const first: number[] = [], last: number[] = [];
  let cursor = 0;
  for (const lock of locks) {
    const text = source.slice(lock.from, lock.to), at = output.indexOf(text, cursor);
    if (at < 0) return { locks: [], complete: false };
    first.push(at); cursor = at + text.length;
  }
  cursor = output.length;
  for (let i = locks.length - 1; i >= 0; i--) {
    const text = source.slice(locks[i].from, locks[i].to);
    const at = output.lastIndexOf(text, cursor - text.length);
    if (at < 0 || at + text.length > cursor) return { locks: [], complete: false };
    last[i] = at; cursor = at;
  }
  return {
    locks: locks.flatMap((lock, i) => first[i] === last[i] ? [{ ...lock, from: first[i], to: first[i] + lock.to - lock.from, sourceFrom: lock.from, sourceTo: lock.to }] : []),
    complete: first.every((at, i) => at === last[i]),
  };
}
