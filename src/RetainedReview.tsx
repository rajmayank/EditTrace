import { ChevronDown, RotateCcw, CircleAlert } from 'lucide-react';
import type { Issue, Reveal } from './core/types';

export function RetainedReview({ issues, source, active, onLocate, onRetry, retrying }: {
  issues: Issue[]; source: string; active?: Reveal; onLocate: (issue: Issue) => void;
  onRetry: (issue: Issue) => void; retrying: number | null;
}) {
  return <aside className="retained-review" aria-label="Retained passages">
    <details>
    <summary className="retained-heading"><CircleAlert size={14} /><span className="retained-count">{issues.length} original passage{issues.length === 1 ? '' : 's'} kept</span>{retrying !== null && <span className="spinner" />}<ChevronDown className="retained-chevron" size={14} /></summary>
    <ol>{issues.map((issue, i) => <li key={issue.from}>
      <button aria-label={`Show retained passage ${i + 1}`} className={'retained-locate ' + (active?.from === issue.outputFrom ? 'active' : '')} onClick={() => onLocate(issue)}>
        <span className="retained-detail"><strong>{source.slice(issue.from, issue.to).replace(/\s+/g, ' ').trim()}</strong><small>{issue.message.replace(/ Original kept\.$/, '')}</small></span>
        <span className="locate-label">Show passage</span>
      </button>
      <button className="retry-passage" aria-label={retrying === issue.from ? `Retrying passage ${i + 1}` : `Retry passage ${i + 1}`} disabled={retrying !== null} onClick={() => onRetry(issue)}>{retrying === issue.from ? <span className="spinner" /> : <RotateCcw size={12} />}<span>{retrying === issue.from ? 'Retrying…' : 'Retry'}</span></button>
    </li>)}</ol>
    </details>
  </aside>;
}
