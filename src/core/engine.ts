import { complete } from './api';
import { planDocument } from './plan';
import { protect, restore, streamText } from './protection';
import type { Connection, Issue, Lock } from './types';

const PROTOCOL = `You are editing one passage from a document. Return only its edited text.
Preserve the argument, factual certainty, technical names, and paragraph structure.
Each [[ET_...]] marker is protected text. Copy every marker EXACTLY ONCE, in its original order.
Do not change marker spelling, insert other markers, wrap the result in a code block, add headings,
or add explanations. Protected line breaks must stay as markers. Do not add new line breaks.
Preserve leading and trailing spaces when the passage continues a sentence.`;

export type Progress = { text: string; preview: string; streamed: boolean; issues: Issue[]; done: number; total: number; retry: boolean };
export async function editDocument(
  source: string, locks: Lock[], connection: Connection, instructions: string, signal: AbortSignal,
  onProgress: (progress: Progress) => void,
  generate: typeof complete = complete,
): Promise<Progress> {
  const plan = planDocument(source, locks);
  const parts = plan.map(p => p.source), issues: Issue[] = [];
  const total = plan.filter(p => p.editable).length;
  let done = 0, preview = '', receivedText = false;
  const prefix = (end: number) => parts.slice(0, end).join('');
  const emit = (retry = false) => onProgress({ text: parts.join(''), preview, streamed: receivedText, issues: [...issues], done, total, retry });
  emit();
  for (let i = 0; i < plan.length; i++) {
    signal.throwIfAborted();
    const unit = plan[i];
    if (!unit.editable) continue;
    const p = protect(unit.source, unit.locks);
    let accepted = false, reason = 'Protected text changed.';
    for (let attempt = 0; attempt < 2; attempt++) {
      signal.throwIfAborted(); parts[i] = unit.source;
      preview = receivedText ? prefix(i) : '';
      emit(attempt > 0);
      try {
        const result = await generate(connection, instructions + '\n\n' + PROTOCOL, p.text, signal, text => {
          if (text) receivedText = true;
          parts[i] = streamText(text, p); preview = receivedText ? prefix(i + 1) : ''; emit(attempt > 0);
        });
        const restored = restore(result, p);
        const unprotected = p.tokens.reduce((s, t) => s.replace(t.marker, ''), result);
        if (restored === null) reason = 'Protected text changed or moved.';
        else if (/[\r\n]/.test(unprotected) && !/[\r\n]/.test(p.text)) reason = 'Paragraph structure changed.';
        else if (!restored.trim() || restored.trim().length < unit.source.trim().length * 0.45) reason = 'The passage was shortened too much.';
        else if (/^\s*(?:```|#{1,6}\s)/.test(unprotected)) reason = 'Unexpected formatting was added.';
        else if ((restored.match(/<\/?[A-Za-z][^>\r\n]*>/g) ?? []).some(tag => !unit.source.includes(tag))) reason = 'Unexpected HTML was added.';
        else {
          const leading = unit.source.match(/^\s*/)?.[0] ?? '';
          const trailing = unit.source.match(/\s*$/)?.[0] ?? '';
          parts[i] = leading + restored.trim() + trailing;
          accepted = true; break;
        }
      } catch (error) {
        if (signal.aborted) { parts[i] = unit.source; preview = receivedText ? prefix(i + 1) : ''; emit(); throw error; }
        reason = error instanceof TypeError ? 'Could not reach the model server.' : error instanceof Error ? error.message : 'Generation failed.';
        // Connection/auth failures affect the entire run; do not submit every remaining passage.
        if (error instanceof TypeError || /Authentication|Endpoint or model|Server returned/.test(reason)) {
          parts[i] = unit.source; preview = receivedText ? prefix(i + 1) : ''; emit(); throw error;
        }
      }
    }
    if (!accepted) { parts[i] = unit.source; issues.push({ from: unit.from, to: unit.to, message: reason + ' Original kept.' }); }
    done++; preview = prefix(i + 1); emit();
  }
  return { text: parts.join(''), preview: parts.join(''), streamed: receivedText, issues, done, total, retry: false };
}
