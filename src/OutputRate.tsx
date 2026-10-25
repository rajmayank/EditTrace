import { useEffect, useMemo, useState } from 'react';
import { Gauge } from 'lucide-react';
import { outputWordsPerMinute, type GenerationStats } from './core/metrics';

export function OutputRate({ stats, active }: { stats: GenerationStats; active: boolean }) {
  const anchor = useMemo(() => performance.now(), [stats]);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => tick(n => n + 1), 250);
    return () => clearInterval(timer);
  }, [active]);
  const elapsed = stats.elapsedMs + (active ? performance.now() - anchor : 0);
  const rate = active && elapsed < 1000 ? null : outputWordsPerMinute(stats, elapsed);
  if (!active && !stats.words) return null;
  return <div className="run-metrics" aria-label="Model output speed" aria-live="off" title="Approximate model words received per elapsed minute, including server wait and retries. Restored protected text is excluded.">
    <Gauge size={12} /><span>{rate === null ? '—' : '≈ ' + rate.toLocaleString()} words/min</span><span aria-hidden="true">·</span><span>{(elapsed / 1000).toFixed(1)}s elapsed</span>
  </div>;
}
