import readingTime from 'reading-time/lib/reading-time';
import { marked, type Token, type Tokens } from 'marked';
import type { Format } from './types';

export type ReadingEstimate = { words: number; minutes: number; timeMs: number; codeWords: number; images: number };
const entities: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decode(text: string) {
  return text.replace(/&(nbsp|amp|lt|gt|quot|apos);/g, (_all, name: string) => entities[name]).replace(/&#(x[\da-f]+|\d+);/gi, (_all, value: string) => {
    const code = value[0].toLowerCase() === 'x' ? parseInt(value.slice(1), 16) : parseInt(value, 10);
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : ' ';
  });
}

/** Parse locally; image URLs and link destinations are never fetched. */
export function estimateReading(value: string, format: Format): ReadingEstimate {
  const code: string[] = [];
  let images = 0;
  const visibleHTML = (html: string) => {
    const visible = html.replace(/<!--[\s\S]*?(?:-->|$)/g, ' ').replace(/<(script|style|head)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, ' ');
    images += (visible.match(/<img\b[^>]*>/gi) ?? []).length;
    return visible.replace(/<[^>]*>/g, ' ');
  };
  const walk = (tokens: Token[]): string => tokens.map(token => {
    const children: Token[] = 'tokens' in token && Array.isArray(token.tokens) ? token.tokens : [];
    const text = 'text' in token && typeof token.text === 'string' ? token.text : '';
    switch (token.type) {
      case 'code': case 'codespan': code.push(text); return ' ';
      case 'image': images++; return children.length ? walk(children) : text;
      case 'list': return (token as Tokens.List).items.map(item => walk(item.tokens)).join('\n') + '\n';
      case 'table': {
        const table = token as Tokens.Table;
        return [table.header, ...table.rows].map(row => row.map(cell => walk(cell.tokens)).join(' ')).join('\n') + '\n';
      }
      case 'html': return visibleHTML(text);
      case 'def': case 'space': case 'hr': case 'br': case 'checkbox': return '\n';
      case 'paragraph': case 'heading': return (children.length ? walk(children) : text) + '\n';
      default: return children.length ? walk(children) : text;
    }
  }).join('');
  const markdown = value.replace(/^---[ \t]*(?:\r\n|\n|\r)[\s\S]*?(?:\r\n|\n|\r)(?:---|\.\.\.)[ \t]*(?:(?:\r\n|\n|\r)|$)/, '');
  const prose = readingTime(format === 'markdown' ? decode(walk(marked.lexer(markdown, { gfm: true }))) : value, { wordsPerMinute: 200 });
  const codeStats = readingTime(code.join('\n'), { wordsPerMinute: 100 });
  let imageTime = 0;
  for (let i = 0; i < images; i++) imageTime += Math.max(12 - i, 3) * 1000;
  const timeMs = prose.time + codeStats.time + imageTime;
  return { words: prose.words + codeStats.words, codeWords: codeStats.words, images, timeMs, minutes: Math.ceil(timeMs / 60000) };
}
