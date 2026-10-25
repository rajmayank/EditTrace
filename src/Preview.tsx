import { useId, useImperativeHandle, useMemo, useRef, type Ref } from 'react';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { documentBlocks, type ScrollSurface } from './core/scroll';
export function Preview({ value, scrollRef }: { value: string; scrollRef?: Ref<ScrollSurface> }) {
  const host = useRef<HTMLDivElement>(null);
  const owner = useId();
  const content = useMemo(() => {
    const blocks = documentBlocks(value, true);
    const annotated = blocks.map((block, index) => `<span class="preview-scroll-anchor" data-scroll-owner="${owner}" data-scroll-block="${index}" aria-hidden="true"></span>` + marked.parser([block.token!], { gfm: true })).join('\n');
    return { count: blocks.length, html: DOMPurify.sanitize(annotated, {
      FORBID_TAGS: ['img', 'iframe', 'form', 'input', 'video', 'audio', 'svg', 'math', 'style'],
      FORBID_ATTR: ['style', 'id', 'name', 'target'],
    }) };
  }, [value, owner]);
  const count = useRef(content.count); count.current = content.count;
  useImperativeHandle(scrollRef, () => ({
    element: () => host.current,
    blocks: () => {
      const element = host.current;
      if (!element) return [];
      const top = element.getBoundingClientRect().top;
      const positions = new Map<number, number>();
      for (const anchor of element.querySelectorAll<HTMLElement>(`[data-scroll-owner="${owner}"]`)) {
        const next = anchor.nextElementSibling;
        const block = next && !next.classList.contains('preview-scroll-anchor') ? next : anchor;
        if (block.getClientRects().length) positions.set(Number(anchor.dataset.scrollBlock), block.getBoundingClientRect().top - top + element.scrollTop);
      }
      const end = element.scrollHeight - parseFloat(getComputedStyle(element).paddingBottom);
      const starts: number[] = [];
      // Hidden content (such as a closed details element) occupies no scroll distance.
      for (let i = count.current - 1; i >= 0; i--) starts[i] = positions.get(i) ?? starts[i + 1] ?? end;
      return starts.map((start, i) => ({ top: start, bottom: starts[i + 1] ?? Math.max(start, end) }));
    },
  }), []);
  return <div ref={host} className="markdown-preview" aria-label="Markdown preview" dangerouslySetInnerHTML={{ __html: content.html }} />;
}
