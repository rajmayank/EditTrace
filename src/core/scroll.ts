import { marked, type Token } from 'marked';

export type DocumentBlock = { fromLine: number; toLine: number; token?: Token };
export type BlockBounds = { top: number; bottom: number };
export type ScrollPosition = { top: number; max: number; blocks: BlockBounds[] };
export type ScrollSurface = { element: () => HTMLElement | null; blocks: () => BlockBounds[] };

/** Shared block order for source editors and rendered Markdown, including CRLF files. */
export function documentBlocks(value: string, markdown: boolean): DocumentBlock[] {
  const blocks: DocumentBlock[] = [];
  if (markdown) {
    let line = 1;
    for (const token of marked.lexer(value, { gfm: true })) {
      const fromLine = line;
      line += (token.raw.match(/\n/g) ?? []).length;
      if (token.type !== 'space' && token.type !== 'def') {
        blocks.push({ fromLine, toLine: Math.max(fromLine, line - (token.raw.endsWith('\n') ? 1 : 0)), token });
      }
    }
  } else {
    let fromLine = 0;
    const lines = value.split(/\r\n?|\n/);
    for (let i = 0; i <= lines.length; i++) {
      if (i < lines.length && lines[i].trim()) { if (!fromLine) fromLine = i + 1; }
      else if (fromLine) { blocks.push({ fromLine, toLine: i }); fromLine = 0; }
    }
  }
  return blocks;
}

const clamp = (value: number, max: number) => Math.max(0, Math.min(value, max));

/** Align matching blocks; interpolate inside a block rather than across the whole document. */
export function alignedScroll(from: ScrollPosition, to: ScrollPosition): number {
  if (!to.blocks.length || !from.blocks.length || to.max <= 0 || from.top <= 0) return 0;
  if (from.max > 0 && from.top >= from.max - 1 && from.blocks.length === to.blocks.length) return to.max;
  let index = 0;
  while (index + 1 < from.blocks.length && from.blocks[index + 1].top <= from.top) index++;
  // An unfinished output has no counterpart for passages that have not arrived yet.
  if (index >= to.blocks.length) return to.max;
  const start = from.blocks[index].top;
  const end = from.blocks[index + 1]?.top ?? from.blocks[index].bottom;
  const fraction = Math.max(0, Math.min(1, (from.top - start) / Math.max(1, end - start)));
  const target = to.blocks[index];
  const targetEnd = to.blocks[index + 1]?.top ?? target.bottom;
  return clamp(target.top + fraction * Math.max(0, targetEnd - target.top), to.max);
}
