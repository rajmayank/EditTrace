import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import { basicSetup } from 'codemirror';
import { Annotation, Compartment, EditorSelection, EditorState, StateEffect, StateField, Transaction } from '@codemirror/state';
import { Decoration, EditorView, showTooltip, tooltips, type DecorationSet, type Tooltip } from '@codemirror/view';
import { markdown } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import type { Lock, Reveal, Span } from './core/types';
import { documentBlocks, type ScrollSurface } from './core/scroll';
import { editorText } from './core/editorText';

const external = Annotation.define<boolean>();
const proseHighlight = HighlightStyle.define([
  { tag: tags.heading, class: 'et-heading' },
  { tag: [tags.link, tags.url], class: 'et-link' },
  { tag: tags.monospace, class: 'et-code' },
  { tag: tags.emphasis, class: 'et-emphasis' },
  { tag: tags.strong, class: 'et-strong' },
  { tag: [tags.processingInstruction, tags.meta], class: 'et-notation' },
]);
const setMarks = StateEffect.define<DecorationSet>();
const setLocks = StateEffect.define<Lock[]>();
const lockField = StateField.define<Lock[]>({
  create: () => [],
  update(value, tr) {
    value = value.flatMap(range => {
      let touched = false;
      tr.changes.iterChangedRanges((from, to) => { if (from < range.to && to > range.from || from === to && from > range.from && from < range.to) touched = true; });
      return touched ? [] : [{ ...range, from: tr.changes.mapPos(range.from, 1), to: tr.changes.mapPos(range.to, -1) }];
    });
    for (const effect of tr.effects) if (effect.is(setLocks)) value = effect.value;
    return value;
  },
});
const marksField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    value = value.map(tr.changes);
    for (const effect of tr.effects) if (effect.is(setMarks)) value = effect.value;
    return value;
  },
  provide: field => EditorView.decorations.from(field),
});
export type EditorProps = {
  value: string; label: string; readOnly?: boolean; isMarkdown?: boolean;
  locks?: Lock[]; changes?: Span[]; changeKind?: 'added' | 'removed';
  retained?: Span[]; reveal?: Reveal;
  scrollRef?: Ref<ScrollSurface>;
  lockEdits?: boolean;
  onBlockedEdit?: () => void;
  onChange?: (value: string, map: (ranges: Span[]) => Span[]) => void;
  onSelection?: (range: Span) => void;
  onLockSelection?: (range: Span) => void;
};
export function Editor(props: EditorProps) {
  const host = useRef<HTMLDivElement>(null), view = useRef<EditorView | null>(null), latest = useRef(props);
  const mode = useRef(new Compartment()), language = useRef(new Compartment());
  const raw = useRef<ReturnType<typeof editorText> | null>(null);
  raw.current ??= editorText(props.value);
  const blockCache = useRef<{ value: string; markdown: boolean; blocks: ReturnType<typeof documentBlocks> } | null>(null);
  latest.current = props;
  useImperativeHandle(props.scrollRef, () => ({
    element: () => view.current?.scrollDOM ?? null,
    blocks: () => {
      const v = view.current;
      if (!v) return [];
      const { value, isMarkdown } = latest.current;
      if (blockCache.current?.value !== value || blockCache.current.markdown !== !!isMarkdown) {
        blockCache.current = { value, markdown: !!isMarkdown, blocks: documentBlocks(value, !!isMarkdown) };
      }
      const padding = v.documentPadding.top;
      return blockCache.current.blocks.map(block => ({
        top: v.lineBlockAt(v.state.doc.line(Math.min(block.fromLine, v.state.doc.lines)).from).top + padding,
        bottom: v.lineBlockAt(v.state.doc.line(Math.min(block.toLine, v.state.doc.lines)).to).bottom + padding,
      }));
    },
  }), []);
  useEffect(() => {
    const factTooltip = StateField.define<readonly Tooltip[]>({
      create: () => [],
      update(_value, tr) {
        const selected = tr.state.selection.main;
        if (selected.empty || tr.state.readOnly || !latest.current.onLockSelection || tr.state.field(lockField).some(r => r.kind.includes('Fact') && r.from <= selected.from && r.to >= selected.to)) return [];
        return [{ pos: selected.from, end: selected.to, above: true, create(editor) {
          const dom = document.createElement('div'); dom.className = 'fact-tooltip';
          const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Lock as fact';
          button.onpointerdown = event => event.preventDefault();
          button.onclick = () => {
            const range = editor.state.selection.main;
            if (!range.empty) latest.current.onLockSelection?.({ from: raw.current!.toRaw(range.from), to: raw.current!.toRaw(range.to) });
            editor.dispatch({ selection: { anchor: range.to } });
          };
          dom.append(button); return { dom };
        } }];
      },
      provide: field => showTooltip.computeN([field], state => state.field(field)),
    });
    const v = new EditorView({ parent: host.current!, state: EditorState.create({ doc: raw.current!.normalized, extensions: [
      basicSetup, EditorView.lineWrapping, marksField, syntaxHighlighting(proseHighlight), factTooltip, tooltips({ parent: document.body }),
      lockField.init(() => (latest.current.locks ?? []).map(lock => ({ ...lock, from: raw.current!.toDoc(lock.from), to: raw.current!.toDoc(lock.to) }))),
      EditorState.transactionFilter.of(tr => {
        if (!tr.docChanged || tr.annotation(external)) return tr;
        if (latest.current.readOnly) return [];
        if (!latest.current.lockEdits) return tr;
        let blocked = false;
        tr.changes.iterChangedRanges((from, to) => {
          if (tr.startState.field(lockField).some(lock => from < lock.to && to > lock.from || from === to && from > lock.from && from < lock.to)) blocked = true;
        });
        if (blocked) { queueMicrotask(() => latest.current.onBlockedEdit?.()); return []; }
        return tr;
      }),
      mode.current.of([]), language.current.of([]),
      EditorView.contentAttributes.of({ 'aria-label': props.label, spellcheck: 'false', tabindex: '0' }),
      EditorView.updateListener.of(update => {
        if (update.docChanged && !update.transactions.some(tr => tr.annotation(external))) {
          const before = raw.current!;
          let value = '', cursor = 0;
          update.changes.iterChanges((from, to, _a, _b, inserted) => {
            value += before.value.slice(cursor, before.toRaw(from)) + inserted.toString().replace(/\n/g, before.lineEnding);
            cursor = before.toRaw(to);
          });
          const after = editorText(value + before.value.slice(cursor)); raw.current = after;
          latest.current.onChange?.(after.value, ranges => ranges.flatMap(r => {
            const start = before.toDoc(r.from), end = before.toDoc(r.to);
            let touched = false;
            update.changes.iterChangedRanges((from, to) => { if ((from < end && to > start) || (from === to && from > start && from < end)) touched = true; });
            if (touched) return [];
            const from = after.toRaw(update.changes.mapPos(start, 1)), to = after.toRaw(update.changes.mapPos(end, -1));
            return to > from ? [{ ...r, from, to }] : [];
          }));
        }
        if (update.selectionSet || update.docChanged) {
          const s = update.state.selection.main;
          latest.current.onSelection?.({ from: raw.current!.toRaw(s.from), to: raw.current!.toRaw(s.to) });
        }
      }),
    ] }) });
    view.current = v;
    return () => { v.destroy(); view.current = null; };
  }, []);
  useEffect(() => {
    const v = view.current!;
    raw.current = editorText(props.value);
    if (v.state.doc.toString() !== raw.current.normalized) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: raw.current.normalized }, annotations: [external.of(true), Transaction.addToHistory.of(false)] });
  }, [props.value]);
  useEffect(() => {
    view.current!.dispatch({ effects: [
      mode.current.reconfigure([EditorState.readOnly.of(!!props.readOnly), EditorView.editable.of(!props.readOnly)]),
      language.current.reconfigure(props.isMarkdown ? markdown() : []),
    ] });
  }, [props.readOnly, props.isMarkdown]);
  useEffect(() => {
    const marks = [
      ...(props.locks ?? []).map(r => ({ ...r, className: 'locked', title: 'Protected: ' + r.kind })),
      ...(props.changes ?? []).map(r => ({ ...r, className: props.changeKind ?? 'removed', title: '' })),
      ...(props.retained ?? []).map(r => ({ ...r, className: 'retained-passage', title: 'Original kept after a protection check failed' })),
      ...(props.reveal ? [{ ...props.reveal, className: 'review-focus', title: 'Located passage' }] : []),
    ];
    const index = raw.current!;
    const nativeLocks = (props.locks ?? []).filter(r => r.from >= 0 && r.to <= props.value.length && r.to > r.from).map(r => ({ ...r, from: index.toDoc(r.from), to: index.toDoc(r.to) }));
    view.current!.dispatch({ effects: [
      setLocks.of(nativeLocks),
      setMarks.of(Decoration.set(marks.filter(r => r.to > r.from && r.from >= 0 && r.to <= props.value.length).map(r => Decoration.mark({ class: r.className, attributes: { title: r.title } }).range(index.toDoc(r.from), index.toDoc(r.to))), true)),
    ] });
  }, [props.locks, props.changes, props.changeKind, props.value, props.retained, props.reveal]);
  useEffect(() => {
    const v = view.current;
    if (!v || !props.reveal) return;
    const from = Math.max(0, Math.min(raw.current!.toDoc(props.reveal.from), v.state.doc.length)), to = Math.max(from, Math.min(raw.current!.toDoc(props.reveal.to), v.state.doc.length));
    v.dispatch({ effects: EditorView.scrollIntoView(EditorSelection.range(from, to), { y: 'center' }) });
    v.focus();
  }, [props.reveal]);
  return <div className="editor-host" ref={host} />;
}
