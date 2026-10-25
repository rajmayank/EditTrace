import { useCallback, useEffect, useRef, type UIEvent } from 'react';
import { alignedScroll, type ScrollSurface } from './core/scroll';

type Side = 'original' | 'edited';

export function useLinkedScroll(enabled: boolean, originalView: string, editedView: string) {
  const original = useRef<ScrollSurface>(null), edited = useRef<ScrollSurface>(null);
  const active = useRef<Side>('original'), frame = useRef(0);
  const linked = useRef(enabled); linked.current = enabled;
  const expected = useRef(new WeakMap<HTMLElement, number>());
  const views = useRef({ original: originalView, edited: editedView });
  const sync = useCallback((side: Side) => {
    active.current = side;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      if (!linked.current) return;
      const from = (side === 'original' ? original : edited).current;
      const to = (side === 'original' ? edited : original).current;
      const a = from?.element(), b = to?.element();
      // Mobile shows one pane at a time. Never move a hidden pane or the page itself.
      if (!a?.clientHeight || !b?.clientHeight || !from || !to) return;
      const top = alignedScroll(
        { top: a.scrollTop, max: a.scrollHeight - a.clientHeight, blocks: from.blocks() },
        { top: b.scrollTop, max: b.scrollHeight - b.clientHeight, blocks: to.blocks() },
      );
      if (Math.abs(b.scrollTop - top) < 1) return;
      b.scrollTop = top;
      expected.current.set(b, b.scrollTop);
    });
  }, []);
  const onScrollCapture = useCallback((event: UIEvent<HTMLDivElement>) => {
    const element = event.target as HTMLElement;
    const side = element === original.current?.element() ? 'original' : element === edited.current?.element() ? 'edited' : null;
    if (!side) return;
    const top = expected.current.get(element);
    // CodeMirror can emit another scroll after rounding its virtual layout.
    if (top !== undefined && Math.abs(element.scrollTop - top) <= 2) return;
    expected.current.delete(element);
    active.current = side;
    if (linked.current) sync(side);
  }, [sync]);
  useEffect(() => {
    if (enabled) sync(active.current);
    else { cancelAnimationFrame(frame.current); expected.current = new WeakMap(); }
    return () => cancelAnimationFrame(frame.current);
  }, [enabled, sync]);
  useEffect(() => {
    if (enabled) {
      if (views.current.original !== originalView) sync('edited');
      else if (views.current.edited !== editedView) sync('original');
    }
    views.current = { original: originalView, edited: editedView };
  }, [enabled, originalView, editedView, sync]);
  return { original, edited, onScrollCapture };
}
