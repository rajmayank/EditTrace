import { ShieldCheck } from 'lucide-react';
import type { Issue, Reveal } from './core/types';

export function RetainedReview({ issues, source, active, onLocate }: {
  issues: Issue[]; source: string; active?: Reveal; onLocate: (issue: Issue) => void;
}) {
  return <aside className="retained-review" aria-label="Retained passages">
    <div className="retained-heading"><ShieldCheck size={14} /><h3>{issues.length} original passage{issues.length === 1 ? '' : 's'} kept</h3></div>
    <ol>{issues.map((issue, i) => <li key={issue.from}>
      <button aria-label={`Show retained passage ${i + 1}`} className={active?.from === issue.outputFrom ? 'active' : ''} onClick={() => onLocate(issue)}>
        <span className="retained-detail"><strong>{source.slice(issue.from, issue.to).replace(/\s+/g, ' ').trim()}</strong><small>{issue.message.replace(/ Original kept\.$/, '')}</small></span>
        <span className="locate-label">Show passage</span>
      </button>
    </li>)}</ol>
  </aside>;
}
