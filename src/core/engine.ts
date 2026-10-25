import { complete } from './api';
import { planDocument } from './plan';
import { protect, restore, streamText } from './protection';
import { GenerationMeter, type GenerationStats } from './metrics';
import type { Connection, Issue, Lock } from './types';

const PROTOCOL = `You are editing one passage from a document. Return only its edited text.
Preserve the argument, factual certainty, technical names, and paragraph structure.
Heading words may be edited; their protected Markdown markers must stay unchanged.
Each [[ET_...]] marker is protected text. Copy every marker EXACTLY ONCE, in its original order.
Do not change marker spelling, insert other markers, wrap the result in a code block, add headings,
or add explanations. Protected line breaks must stay as markers. Do not add new line breaks.
Preserve leading and trailing spaces when the passage continues a sentence.`;

export type Progress = { text: string; preview: string; streamed: boolean; issues: Issue[]; done: number; total: number; retry: boolean; stats: GenerationStats };
export type PassageProgress = Pick<Progress, 'text' | 'issues' | 'streamed' | 'retry' | 'stats'>;
export class PassageStateError extends Error {}

/** Retry one retained unit, preserving every other accepted edit and source offset. */
export async function retryPassage(
  source: string, output: string, locks: Lock[], issues: Issue[], target: Issue,
  connection: Connection, instructions: string, signal: AbortSignal,
  onProgress: (progress: PassageProgress) => void, generate: typeof complete = complete,
): Promise<PassageProgress> {
  const index = issues.findIndex(issue => issue.from === target.from && issue.to === target.to && issue.outputFrom === target.outputFrom && issue.outputTo === target.outputTo);
  const validRange = (from: number, to: number, length: number) => Number.isSafeInteger(from) && Number.isSafeInteger(to) && from >= 0 && to > from && to <= length;
  // Saved review metadata must still describe literal original text before it is submitted.
  if (index < 0 || issues.some((issue, i) => !validRange(issue.from, issue.to, source.length) || !validRange(issue.outputFrom, issue.outputTo, output.length) || source.slice(issue.from, issue.to) !== output.slice(issue.outputFrom, issue.outputTo) || i > 0 && (issues[i - 1].to > issue.from || issues[i - 1].outputTo > issue.outputFrom))) {
    throw new PassageStateError('This passage no longer matches the draft. Run a fresh edit before retrying.');
  }
  const original = source.slice(target.from, target.to);
  const localLocks = locks.filter(lock => lock.from < target.to && lock.to > target.from).map(lock => ({ ...lock, from: Math.max(target.from, lock.from) - target.from, to: Math.min(target.to, lock.to) - target.from }));
  const editable = planDocument(original, localLocks).filter(unit => unit.editable);
  if (editable.length !== 1) throw new PassageStateError('This passage cannot be retried separately. Run a fresh edit with the current locks.');
  const prefix = output.slice(0, target.outputFrom), suffix = output.slice(target.outputTo);
  // Source positions stay fixed; later output positions move with the replacement length.
  const patch = (text: string, keep: boolean, message = target.message): Pick<PassageProgress, 'text' | 'issues'> => {
    const delta = text.length - original.length;
    return {
      text: prefix + text + suffix,
      issues: issues.flatMap((issue, i) => i === index ? keep ? [{ ...issue, outputTo: issue.outputFrom + text.length, message }] : [] : [{ ...issue, outputFrom: issue.outputFrom + (i > index ? delta : 0), outputTo: issue.outputTo + (i > index ? delta : 0) }]),
    };
  };
  let streamed = false;
  let stats: GenerationStats = { words: 0, elapsedMs: 0 };
  try {
    const result = await editDocument(original, localLocks, connection, instructions, signal, progress => {
      streamed = progress.streamed;
      stats = progress.stats;
      onProgress({ ...patch(progress.preview || original, true), streamed, retry: progress.retry, stats });
    }, generate);
    return { ...patch(result.text, !!result.issues.length, result.issues[0]?.message), streamed: result.streamed, retry: false, stats: result.stats };
  } catch (error) {
    onProgress({ text: output, issues, streamed, retry: false, stats });
    throw error;
  }
}

export async function editDocument(
  source: string, locks: Lock[], connection: Connection, instructions: string, signal: AbortSignal,
  onProgress: (progress: Progress) => void,
  generate: typeof complete = complete,
): Promise<Progress> {
  const plan = planDocument(source, locks);
  const parts = plan.map(p => p.source), issues: Issue[] = [];
  const total = plan.filter(p => p.editable).length;
  const meter = new GenerationMeter();
  let done = 0, preview = '', receivedText = false;
  const prefix = (end: number) => parts.slice(0, end).join('');
  const emit = (retry = false) => onProgress({ text: parts.join(''), preview, streamed: receivedText, issues: [...issues], done, total, retry, stats: meter.snapshot() });
  emit();
  for (let i = 0; i < plan.length; i++) {
    signal.throwIfAborted();
    const unit = plan[i];
    if (!unit.editable) continue;
    const p = protect(unit.source, unit.locks);
    let accepted = false, reason = 'Protected text changed.';
    for (let attempt = 0; attempt < 2; attempt++) {
      signal.throwIfAborted(); parts[i] = unit.source;
      meter.beginAttempt();
      preview = receivedText ? prefix(i) : '';
      emit(attempt > 0);
      try {
        const result = await generate(connection, instructions + '\n\n' + PROTOCOL, p.text, signal, text => {
          meter.observe(text);
          if (text) receivedText = true;
          parts[i] = streamText(text, p); preview = receivedText ? prefix(i + 1) : ''; emit(attempt > 0);
        });
        meter.observe(result);
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
    if (!accepted) {
      parts[i] = unit.source;
      const outputFrom = prefix(i).length;
      issues.push({ from: unit.from, to: unit.to, outputFrom, outputTo: outputFrom + unit.source.length, message: reason + ' Original kept.' });
    }
    done++; preview = prefix(i + 1); emit();
  }
  return { text: parts.join(''), preview: parts.join(''), streamed: receivedText, issues, done, total, retry: false, stats: meter.snapshot() };
}
