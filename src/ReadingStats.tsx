import type { ReadingEstimate } from './core/reading';

export function ReadingStats({ estimate, label }: { estimate: ReadingEstimate; label: string }) {
  return <span className="document-stats" aria-label={`${label} word count and reading time`}>
    <span className="word-count">{estimate.words.toLocaleString()} words</span><span aria-hidden="true">·</span>
    <span className="reading-time" title="Approximate reading time: prose at 200 words/min, code at 100 words/min, plus an image allowance.">{estimate.timeMs > 0 && estimate.timeMs < 60000 ? '<1' : estimate.minutes} min read</span>
  </span>;
}
