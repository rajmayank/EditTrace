import type { Lock, Span } from './types';
export type Unit = Span & { source: string; locks: Lock[]; editable: boolean };

/** Paragraph separators and whitespace remain outside generation. */
export function planDocument(text: string, locks: Lock[], limit = 2200): Unit[] {
  const units: Unit[] = [];
  const add = (from: number, to: number, separator = false) => {
    if (from >= to) return;
    const local = locks.filter(r => r.from < to && r.to > from).map(r => ({ ...r, from: Math.max(from, r.from) - from, to: Math.min(to, r.to) - from }));
    const source = text.slice(from, to);
    let prose = '', cursor = 0;
    for (const r of local) { prose += source.slice(cursor, r.from); cursor = r.to; }
    prose += source.slice(cursor);
    units.push({ from, to, source, locks: local, editable: !separator && /[\p{L}\p{N}]/u.test(prose) });
  };
  const paragraph = (from: number, to: number) => {
    const raw = text.slice(from, to);
    const leading = raw.match(/^\s*/)?.[0].length ?? 0;
    const trailing = raw.match(/\s*$/)?.[0].length ?? 0;
    add(from, from + leading, true);
    let start = from + leading;
    const end = Math.max(start, to - trailing);
    while (end - start > limit) {
      let cut = start + limit;
      const candidates = [...text.slice(start, cut).matchAll(/[.!?][ \t]+|\r?\n|[ \t]+/g)];
      const candidate = candidates.filter(m => m.index > limit / 2).at(-1);
      if (candidate) cut = start + candidate.index + candidate[0].length;
      const crossing = locks.find(r => r.from < cut && r.to > cut);
      if (crossing) cut = crossing.from > start ? crossing.from : Math.min(crossing.to, end);
      add(start, cut); start = cut;
    }
    add(start, end); add(end, to, true);
  };
  let at = 0;
  for (const m of text.matchAll(/(?:\r\n|\n|\r)[ \t]*(?:\r\n|\n|\r)(?:[ \t]*(?:\r\n|\n|\r))*/g)) {
    paragraph(at, m.index); add(m.index, m.index + m[0].length, true); at = m.index + m[0].length;
  }
  paragraph(at, text.length);
  return units;
}
