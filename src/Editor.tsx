import { useEffect, useRef } from 'react';
import { basicSetup } from 'codemirror';
import { Annotation, Compartment, EditorSelection, EditorState, StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, showTooltip, tooltips, type DecorationSet, type Tooltip } from '@codemirror/view';
import { markdown } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import type { Lock, Reveal, Span } from './core/types';

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
  onChange?: (value: string, map: (ranges: Span[]) => Span[]) => void;
  onSelection?: (range: Span) => void;
  onLockSelection?: (range: Span) => void;
};
export function Editor(props: EditorProps) {
  const host = useRef<HTMLDivElement>(null), view = useRef<EditorView | null>(null), latest = useRef(props);
  const mode = useRef(new Compartment()), language = useRef(new Compartment());
  latest.current = props;
  useEffect(() => {
    const factTooltip = StateField.define<readonly Tooltip[]>({
      create: () => [],
      update(_value, tr) {
        const selected = tr.state.selection.main;
        if (selected.empty || tr.state.readOnly || !latest.current.onLockSelection || latest.current.locks?.some(r => r.kind.includes('Fact') && r.from <= selected.from && r.to >= selected.to)) return [];
        return [{ pos: selected.from, end: selected.to, above: true, create(editor) {
          const dom = document.createElement('div'); dom.className = 'fact-tooltip';
          const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Lock as fact';
          button.onpointerdown = event => event.preventDefault();
          button.onclick = () => {
            const range = editor.state.selection.main;
            if (!range.empty) latest.current.onLockSelection?.({ from: range.from, to: range.to });
            editor.dispatch({ selection: { anchor: range.to } });
          };
          dom.append(button); return { dom };
        } }];
      },
      provide: field => showTooltip.computeN([field], state => state.field(field)),
    });
    const v = new EditorView({ parent: host.current!, state: EditorState.create({ doc: latest.current.value, extensions: [
      basicSetup, EditorView.lineWrapping, marksField, syntaxHighlighting(proseHighlight), factTooltip, tooltips({ parent: document.body }),
      mode.current.of([]), language.current.of([]),
      EditorView.contentAttributes.of({ 'aria-label': props.label, spellcheck: 'false', tabindex: '0' }),
      EditorView.updateListener.of(update => {
        if (update.docChanged && !update.transactions.some(tr => tr.annotation(external))) {
          latest.current.onChange?.(update.state.doc.toString(), ranges => ranges.flatMap(r => {
            let touched = false;
            update.changes.iterChangedRanges((from, to) => { if ((from < r.to && to > r.from) || (from === to && from > r.from && from < r.to)) touched = true; });
            if (touched) return [];
            const from = update.changes.mapPos(r.from, 1), to = update.changes.mapPos(r.to, -1);
            return to > from ? [{ from, to }] : [];
          }));
        }
        if (update.selectionSet || update.docChanged) {
          const s = update.state.selection.main;
          latest.current.onSelection?.({ from: s.from, to: s.to });
        }
      }),
    ] }) });
    view.current = v;
    return () => { v.destroy(); view.current = null; };
  }, []);
  useEffect(() => {
    const v = view.current!;
    if (v.state.doc.toString() !== props.value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: props.value }, annotations: external.of(true) });
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
    view.current!.dispatch({ effects: setMarks.of(Decoration.set(marks.filter(r => r.to > r.from && r.from >= 0 && r.to <= props.value.length).map(r => Decoration.mark({ class: r.className, attributes: { title: r.title } }).range(r.from, r.to)), true)) });
  }, [props.locks, props.changes, props.changeKind, props.value, props.retained, props.reveal]);
  useEffect(() => {
    const v = view.current;
    if (!v || !props.reveal) return;
    const from = Math.max(0, Math.min(props.reveal.from, v.state.doc.length)), to = Math.max(from, Math.min(props.reveal.to, v.state.doc.length));
    v.dispatch({ effects: EditorView.scrollIntoView(EditorSelection.range(from, to), { y: 'center' }) });
    v.focus();
  }, [props.reveal]);
  return <div className="editor-host" ref={host} />;
}
