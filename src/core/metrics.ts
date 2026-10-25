import readingTime from 'reading-time/lib/reading-time';

export type GenerationStats = { words: number; elapsedMs: number };

export const wordCount = (text: string) => readingTime(text).words;
export function outputWordsPerMinute(stats: GenerationStats, elapsedMs = stats.elapsedMs) {
  return stats.words > 0 && elapsedMs > 0 ? Math.round(stats.words * 60000 / elapsedMs) : null;
}

/** Count model text, never protected source text restored by the editor. */
export function generatedWordCount(raw: string) {
  let text = raw.replace(/\[\[ET_[^\]]*(?:\]\]?)?/g, ' ').replace(/<[^>]*>/g, ' ');
  for (let length = 4; length >= 1; length--) if (text.endsWith('[[ET_'.slice(0, length))) { text = text.slice(0, -length); break; }
  return wordCount(text);
}

export class GenerationMeter {
  private started: number;
  private completedWords = 0;
  private currentWords = 0;
  constructor(private now = () => performance.now()) { this.started = now(); }
  beginAttempt() { this.completedWords += this.currentWords; this.currentWords = 0; }
  observe(raw: string) { this.currentWords = generatedWordCount(raw); }
  snapshot(): GenerationStats { return { words: this.completedWords + this.currentWords, elapsedMs: Math.max(0, this.now() - this.started) }; }
}
