import { describe, expect, it } from 'vitest';
import { alignedScroll, documentBlocks } from '../src/core/scroll';

describe('document scroll alignment', () => {
  it('keeps code and lists together and tracks original line numbers across CRLF and reference definitions', () => {
    const text = '# Heading\r\n\r\n[guide][ref]\r\n\r\n```txt\r\nfirst\r\n\r\nlast\r\n```\r\n\r\n- First\r\n- Second\r\n\r\n[ref]: https://example.com\r\n';
    const blocks = documentBlocks(text, true);
    expect(blocks.map(({ fromLine, toLine, token }) => [fromLine, toLine, token?.type])).toEqual([
      [1, 1, 'heading'], [3, 3, 'paragraph'], [5, 9, 'code'], [11, 12, 'list'],
    ]);
    expect(blocks[1].token).toMatchObject({ tokens: [{ type: 'link', href: 'https://example.com' }] });
  });

  it('groups wrapped email and text paragraphs without treating their content as Markdown', () => {
    expect(documentBlocks('Hi Alex,\n\nA wrapped line\ncontinues here.\n\nBest,\nMayank\n', false)).toEqual([
      { fromLine: 1, toLine: 1 }, { fromLine: 3, toLine: 4 }, { fromLine: 6, toLine: 7 },
    ]);
  });

  it('aligns a rewritten paragraph and interpolates within it despite different earlier block heights', () => {
    const before = { max: 1400, blocks: [{ top: 24, bottom: 200 }, { top: 240, bottom: 800 }, { top: 840, bottom: 1800 }] };
    const after = { max: 1800, blocks: [{ top: 24, bottom: 400 }, { top: 440, bottom: 1200 }, { top: 1240, bottom: 2200 }] };
    expect(alignedScroll({ ...before, top: 240 }, { ...after, top: 0 })).toBe(440);
    expect(alignedScroll({ ...before, top: 540 }, { ...after, top: 0 })).toBe(840);
    expect(alignedScroll({ ...after, top: 840 }, { ...before, top: 0 })).toBe(540);
  });

  it('aligns document edges and safely handles empty or short content', () => {
    const before = { top: 0, max: 600, blocks: [{ top: 20, bottom: 1000 }] };
    const after = { top: 0, max: 1200, blocks: [{ top: 24, bottom: 1600 }] };
    expect(alignedScroll(before, after)).toBe(0);
    expect(alignedScroll({ ...before, top: 600 }, after)).toBe(1200);
    expect(alignedScroll(before, { ...after, blocks: [] })).toBe(0);
    expect(alignedScroll({ ...before, top: 300 }, { ...after, max: 0 })).toBe(0);
  });

  it('clamps at the generated frontier and maps a partial result back to its matching passage', () => {
    const source = { top: 1800, max: 2400, blocks: [{ top: 20, bottom: 700 }, { top: 740, bottom: 1400 }, { top: 1440, bottom: 2800 }] };
    const partial = { top: 200, max: 200, blocks: [{ top: 20, bottom: 300 }, { top: 340, bottom: 600 }] };
    expect(alignedScroll(source, partial)).toBe(200);
    expect(alignedScroll(partial, source)).toBeCloseTo(425);
    expect(alignedScroll(partial, source)).toBeLessThan(source.blocks[1].top);
  });
});
