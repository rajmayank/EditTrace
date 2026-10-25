import type { Format, Lock, LockOptions, Span } from './types';

export function mergeLocks(ranges: Lock[]): Lock[] {
  const sorted = ranges.filter(r => r.to > r.from).sort((a, b) => a.from - b.from || b.to - a.to);
  const result: Lock[] = [];
  for (const range of sorted) {
    const last = result.at(-1);
    if (last && range.from < last.to) {
      last.to = Math.max(last.to, range.to);
      if (!last.kind.split(', ').includes(range.kind)) last.kind += ', ' + range.kind;
    } else result.push({ ...range });
  }
  return result;
}

export function autoLocks(text: string, format: Format, opts: LockOptions, manual: Span[] = []): Lock[] {
  const ranges: Lock[] = manual.map(r => ({ ...r, kind: 'Fact' }));
  const add = (from: number, to: number, kind: string) => { if (to > from) ranges.push({ from, to, kind }); };
  const find = (regex: RegExp, kind: string) => {
    for (const m of text.matchAll(regex)) add(m.index, m.index + m[0].length, kind);
  };
  const lines = [...text.matchAll(/[^\r\n]*(?:\r\n|\n|\r|$)/g)].filter(m => m[0].length > 0);
  if (format === 'markdown' && opts.structure) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i][0].replace(/[\r\n]+$/, '');
      const start = lines[i].index;
      // These blocks never need a model's interpretation to survive.
      const fence = line.match(/^ {0,3}(`{3,}|~{3,})/);
      if (fence) {
        const marker = fence[1][0], length = fence[1].length;
        let end = text.length;
        for (let j = i + 1; j < lines.length; j++) {
          if (new RegExp('^ {0,3}' + marker + '{' + length + ',}[ \\t]*[\\r\\n]*$').test(lines[j][0])) {
            end = lines[j].index + lines[j][0].length; i = j; break;
          }
        }
        add(start, end, 'Code block');
        if (end === text.length) i = lines.length;
        continue;
      }
      if (i === 0 && /^---[ \t]*$/.test(line)) {
        let end = -1;
        for (let j = 1; j < lines.length; j++) if (/^(---|\.\.\.)[ \t]*[\r\n]*$/.test(lines[j][0])) {
          end = lines[j].index + lines[j][0].length; i = j; break;
        }
        if (end > 0) { add(start, end, 'Front matter'); continue; }
      }
      const heading = line.match(/^ {0,3}#{1,6}(?:[ \t]+|$)/);
      if (heading) {
        add(start, start + heading[0].length, 'Heading marker');
        const closing = /[ \t]+#+[ \t]*$/.exec(line);
        if (closing && closing.index >= heading[0].length) add(start + closing.index, start + line.length, 'Heading marker');
      }
      if (/^ {0,3}(?:=+|-+)[ \t]*$/.test(line) && i > 0 && lines[i - 1][0].trim()) {
        add(start, start + line.length, 'Heading marker');
      }
      if (/^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(line)) add(start, start + line.length, 'Rule');
      if (/^ {0,3}\[[^\]]+\]:/.test(line)) add(start, start + lines[i][0].length, 'Reference');
      if (/^(?: {4}|\t)\S/.test(line)) add(start, start + lines[i][0].length, 'Indented block');
      // Keep tables as source, including a header without a leading pipe.
      const next = lines[i + 1]?.[0] ?? '';
      if (line.includes('|') && /^\s*\|?[ \t]*:?-{3,}:?[ \t]*(?:\|[ \t]*:?-{3,}:?[ \t]*)+\|?[ \t]*[\r\n]*$/.test(next)) {
        let j = i + 2;
        while (j < lines.length && lines[j][0].includes('|') && lines[j][0].trim()) j++;
        add(start, j < lines.length ? lines[j].index : text.length, 'Table'); i = j - 1;
      }
    }
    find(/<!--[\s\S]*?(?:-->|$)/g, 'Comment');
    find(/^ {0,3}\$\$[^\r\n]*(?:\r?\n)[\s\S]*?^ {0,3}\$\$[ \t]*(?:\r?\n|$)/gm, 'Math block');
    find(/^ {0,3}<(?:div|section|table|pre|script|style)\b[\s\S]*?<\/(?:div|section|table|pre|script|style)>/gim, 'HTML block');
    find(/^[ \t]*(?:>[ \t]*)+(?:(?:[-+*]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?)?|^[ \t]*(?:[-+*]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/gm, 'List / quote marker');
    find(/\*\*|__|~~|(?<!\*)\*(?!\*)|(?<![\w_])_(?![\w_])/g, 'Emphasis marker');
    find(/ {2,}(?=\r?$)/gm, 'Hard break');
  }
  if (opts.structure) find(/\r\n|\n|\r/g, 'Line break');
  if (opts.inline) {
    find(/(`+)[^`\r\n]*?\1/g, 'Inline code');
    // Complete Markdown links are atomic; this also protects link labels and images.
    find(/!?\[(?:[^\]\\]|\\.)*\]\((?:[^()\s]|\([^()]*\)|[ \t]+"[^"]*")*\)/g, 'Link');
    find(/!?\[[^\]\n]+\]\[[^\]\n]*\]/g, 'Reference link');
    find(/\[\^[^\]\r\n]+\]/g, 'Footnote reference');
    find(/\bhttps?:\/\/[^\s<>]+|\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/gi, 'Address');
    find(/<\/?[a-z][^>\r\n]*>/gi, 'HTML notation');
    find(/\$[^$\r\n]+\$/g, 'Inline math');
  }
  if (opts.numbers) find(/(?<![\p{L}\p{N}_])[-+]?\d+(?:[.,:/-]\d+)*(?:%|\b)/gu, 'Number');
  if (format === 'email' && opts.signature) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i][0].trimEnd();
      if (/^-- ?$/.test(line) || (lines.length - i <= 14 && /^(?:Best(?: regards| wishes)?|Kind regards|Regards|Warm regards|Sincerely|Cheers|Thanks|Thank you|Respectfully)[,!]?[ \t]*$/i.test(line) && i < lines.length - 1)) {
        add(lines[i].index, text.length, 'Signature'); break;
      }
    }
    const reply = /^On [^\r\n]+wrote:[ \t]*$|^_{5,}[ \t]*$/m.exec(text);
    if (reply) add(reply.index, text.length, 'Quoted thread');
  }
  return mergeLocks(ranges.map(r => ({ ...r, from: Math.max(0, r.from), to: Math.min(text.length, r.to) })));
}

export type ProtectedText = { text: string; tokens: { marker: string; original: string; from: number; to: number; kind: string }[]; namespace: string };
export function protect(text: string, ranges: Lock[], namespace = crypto.randomUUID().replaceAll('-', '').slice(0, 12)): ProtectedText {
  while (text.includes('[[ET_' + namespace)) namespace += 'x';
  const tokens: ProtectedText['tokens'] = [];
  let cursor = 0, result = '';
  for (const r of mergeLocks(ranges)) {
    const marker = `[[ET_${namespace}_${tokens.length}]]`;
    result += text.slice(cursor, r.from) + marker;
    tokens.push({ marker, original: text.slice(r.from, r.to), from: r.from, to: r.to, kind: r.kind }); cursor = r.to;
  }
  return { text: result + text.slice(cursor), tokens, namespace };
}

export function restore(output: string, p: ProtectedText): string | null {
  let last = -1;
  for (const { marker } of p.tokens) {
    const at = output.indexOf(marker);
    if (at < 0 || at <= last || output.indexOf(marker, at + marker.length) !== -1) return null;
    last = at;
  }
  let remainder = output;
  for (const t of p.tokens) remainder = remainder.replace(t.marker, '');
  if (remainder.includes('[[ET_' + p.namespace)) return null;
  let result = output;
  for (const t of p.tokens) result = result.replace(t.marker, () => t.original);
  return result;
}

/** Provisional stream only; final text always goes through restore() and validation. */
export function streamText(output: string, p: ProtectedText): string {
  return restoredStream(output, p).text;
}

export function restoredStream(output: string, p: ProtectedText) {
  const tokens = new Map(p.tokens.map(token => [token.marker, token]));
  const locks: (Lock & { sourceFrom: number; sourceTo: number })[] = [];
  let text = '', cursor = 0;
  for (const match of output.matchAll(/\[\[ET_[^\]]*(?:\]\]?)?/g)) {
    text += output.slice(cursor, match.index);
    const token = tokens.get(match[0]);
    if (token) {
      locks.push({ from: text.length, to: text.length + token.original.length, kind: token.kind, sourceFrom: token.from, sourceTo: token.to });
      text += token.original;
    }
    cursor = match.index + match[0].length;
  }
  let tail = output.slice(cursor);
  for (let n = 4; n >= 1; n--) if (tail.endsWith('[[ET_'.slice(0, n))) { tail = tail.slice(0, -n); break; }
  return { text: text + tail, locks };
}
