import { useCallback, useEffect, useRef, type UIEvent } from 'react';
import { alignedScroll, type ScrollPosition, type ScrollSurface } from './core/scroll';

type Side = 'original' | 'edited';

export function useLinkedScroll(enabled: boolean, originalView: string, editedView: string, layout = 'both') {
  const original = useRef<ScrollSurface>(null), edited = useRef<ScrollSurface>(null);
  const active = useRef<Side>('original'), frame = useRef(0);
  const linked = useRef(enabled); linked.current = enabled;
  const expected = useRef(new WeakMap<HTMLElement, number>());
  const views = useRef({ original: originalView, edited: editedView });
  const positions = useRef<Partial<Record<Side, ScrollPosition>>>({});
  const changingLayout = useRef(false), layoutFrame = useRef(0), measureFrame = useRef(0);
  const position = useCallback((side: Side): ScrollPosition | undefined => {
    const surface = (side === 'original' ? original : edited).current;
    const element = surface?.element();
    return surface && element?.clientHeight ? { top: element.scrollTop, max: element.scrollHeight - element.clientHeight, blocks: surface.blocks() } : undefined;
  }, []);
  const captureLayout = useCallback(() => {
    for (const side of ['original', 'edited'] as const) {
      const current = position(side);
      if (current) positions.current[side] = current;
    }
    changingLayout.current = true;
    cancelAnimationFrame(frame.current);
  }, [position]);
  const sync = useCallback((side: Side) => {
    active.current = side;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      if (!linked.current || changingLayout.current) return;
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
  const restoreLayout = useCallback(() => {
    cancelAnimationFrame(layoutFrame.current); cancelAnimationFrame(measureFrame.current);
    // CodeMirror needs a measurement frame after the panes change width.
    layoutFrame.current = requestAnimationFrame(() => {
      measureFrame.current = requestAnimationFrame(() => {
        const basis = positions.current[active.current] ?? positions.current.original ?? positions.current.edited;
        for (const side of ['original', 'edited'] as const) {
          const before = linked.current ? basis : positions.current[side];
          const after = position(side);
          const element = (side === 'original' ? original : edited).current?.element();
          if (!before || !after || !element) continue;
          element.scrollTop = alignedScroll(before, after);
          expected.current.set(element, element.scrollTop);
        }
        changingLayout.current = false;
        for (const side of ['original', 'edited'] as const) {
          const current = position(side);
          if (current) positions.current[side] = current;
        }
        if (linked.current) sync(active.current);
      });
    });
  }, [position, sync]);
  const onScrollCapture = useCallback((event: UIEvent<HTMLDivElement>) => {
    if (changingLayout.current) return;
    const element = event.target as HTMLElement;
    const side = element === original.current?.element() ? 'original' : element === edited.current?.element() ? 'edited' : null;
    if (!side) return;
    const top = expected.current.get(element);
    // CodeMirror can emit another scroll after rounding its virtual layout.
    if (top !== undefined && Math.abs(element.scrollTop - top) <= 2) return;
    expected.current.delete(element);
    active.current = side;
    const current = position(side);
    if (current) positions.current[side] = current;
    if (linked.current) sync(side);
  }, [position, sync]);
  useEffect(() => {
    if (enabled) sync(active.current);
    else { cancelAnimationFrame(frame.current); expected.current = new WeakMap(); }
    return () => cancelAnimationFrame(frame.current);
  }, [enabled, sync]);
  useEffect(() => {
    if (changingLayout.current) restoreLayout();
    else if (enabled) sync(active.current);
  }, [layout, restoreLayout, sync]);
  useEffect(() => {
    const resize = () => { changingLayout.current = true; restoreLayout(); };
    window.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(layoutFrame.current); cancelAnimationFrame(measureFrame.current);
    };
  }, [restoreLayout]);
  useEffect(() => {
    if (enabled) {
      if (views.current.original !== originalView) sync('edited');
      else if (views.current.edited !== editedView) sync('original');
    }
    views.current = { original: originalView, edited: editedView };
  }, [enabled, originalView, editedView, sync]);
  return { original, edited, onScrollCapture, captureLayout };
}
