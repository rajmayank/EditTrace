import { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { diffWordsWithSpace } from 'diff';
import { ArrowRight, ArrowUpRight, Check, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, CircleCheck, CircleAlert, Clipboard, Copy, Download, FilePenLine, FileUp, History, Link2, LockKeyhole, MessageSquarePlus, Moon, Play, Plus, RotateCcw, Settings2, ShieldCheck, Square, Sun, Trash2, Unlink, Unplug, X } from 'lucide-react';
import { Editor } from './Editor';
import { Preview } from './Preview';
import { autoLocks } from './core/protection';
import { baseURL, connectionError } from './core/api';
import { PROVIDERS, providerFor } from './core/providers';
import { useModelConnection } from './useModelConnection';
import { useLinkedScroll } from './useLinkedScroll';
import { Logo } from './Logo';
import { RetainedReview } from './RetainedReview';
import { ReadingStats } from './ReadingStats';
import { OutputRate } from './OutputRate';
import type { GenerationStats } from './core/metrics';
import { estimateReading } from './core/reading';
import { editDocument, PassageStateError, retryPassage, type Progress } from './core/engine';
import { DEFAULT_LOCKS, type Connection, type Format, type Issue, type Reveal, type Span } from './core/types';
import { draftTitle, PRESETS, SAMPLE } from './core/presets';
import { persistSettings, read, remove, write, type Draft, type SavedSettings } from './core/storage';

const DEFAULT_CONNECTION: Connection = { url: 'http://localhost:1234/v1', model: '', key: '', temperature: 0.3, maxTokens: 4096 };
const defaults: SavedSettings = { connection: DEFAULT_CONNECTION, connectionEnabled: true, linkedScroll: true, rememberKey: false, saveDrafts: false, theme: window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light', preset: 'article', prompt: PRESETS[0].prompt, locks: DEFAULT_LOCKS };
const shortcut = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';
type Entry = Draft & { at: number; id: string };
type Panel = 'connection' | 'prompt' | 'locks' | 'history' | 'help' | null;

export default function App() {
  const [settings, setSettings] = useState(() => {
    const s = read<Partial<SavedSettings>>('settings', {});
    return { ...defaults, ...s, connection: { ...DEFAULT_CONNECTION, ...s.connection }, locks: { ...DEFAULT_LOCKS, ...s.locks } };
  });
  const [initial] = useState(() => settings.saveDrafts ? read<Draft | null>('draft', null) : null);
  const linkedScroll = settings.linkedScroll !== false;
  const [source, setSource] = useState(initial?.source ?? '');
  const [output, setOutput] = useState(initial?.output ?? '');
  const [format, setFormat] = useState<Format>(initial?.format ?? 'markdown');
  const [name, setName] = useState(() => draftTitle(initial?.name));
  const [manual, setManual] = useState<Span[]>(initial?.manual ?? []);
  const [selection, setSelection] = useState<Span>({ from: 0, to: 0 });
  const [progress, setProgress] = useState<Progress | null>(null);
  const [issues, setIssues] = useState<Issue[]>(initial?.issues ?? []);
  const [stats, setStats] = useState<GenerationStats | null>(initial?.stats ?? null);
  const [retrying, setRetrying] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(''), [notice, setNotice] = useState('');
  const [manualModel, setManualModel] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [leftTab, setLeftTab] = useState('source'), [rightTab, setRightTab] = useState('changes');
  const scrolling = useLinkedScroll(linkedScroll, leftTab, rightTab);
  const [mobilePane, setMobilePane] = useState('original');
  const [showDiff, setShowDiff] = useState(true);
  const [originalReveal, setOriginalReveal] = useState<Reveal>(), [resultReveal, setResultReveal] = useState<Reveal>();
  const revealId = useRef(0), resultPanel = useRef<HTMLElement>(null);
  const [changeIndex, setChangeIndex] = useState(-1);
  const [history, setHistory] = useState<Entry[]>(() => settings.saveDrafts ? read<Entry[]>('history', []) : []);
  const abort = useRef<AbortController | null>(null);
  const busyRef = useRef(false), importRef = useRef<HTMLInputElement>(null), dialog = useRef<HTMLDialogElement>(null);
  const sourceRef = useRef(source); sourceRef.current = source;
  const readableSource = useDeferredValue(source), readableOutput = useDeferredValue(output);
  const originalReading = useMemo(() => estimateReading(readableSource, format), [readableSource, format]);
  const editedReading = useMemo(() => estimateReading(readableOutput, format), [readableOutput, format]);
  const locks = useMemo(() => autoLocks(source, format, settings.locks, manual), [source, format, settings.locks, manual]);
  const diff = useMemo(() => {
    const before: Span[] = [], after: Span[] = [];
    if (!output || busy || !showDiff) return { before, after };
    let a = 0, b = 0;
    const changes = diffWordsWithSpace(source, output, { timeout: 1200 });
    for (const part of changes ?? []) {
      if (part.removed) { before.push({ from: a, to: a + part.value.length }); a += part.value.length; }
      else if (part.added) { after.push({ from: b, to: b + part.value.length }); b += part.value.length; }
      else { a += part.value.length; b += part.value.length; }
    }
    return { before, after };
  }, [source, output, busy, showDiff]);
  const modelConnection = useModelConnection(settings.connection, settings.connectionEnabled !== false, found => {
    setSettings(s => ({ ...s, connection: { ...s.connection, model: found.includes(s.connection.model) ? s.connection.model : found[0] } }));
  });
  const { connected, testing, models } = modelConnection;
  const provider = PROVIDERS.find(p => p.id === settings.provider) ?? providerFor(settings.connection.url);
  function setConnection(patch: Partial<Connection>) {
    setSettings(s => ({ ...s, connectionEnabled: true, connection: { ...s.connection, ...patch, ...('url' in patch && patch.url !== s.connection.url ? { model: '' } : {}) } }));
  }
  function chooseProvider(id: string) {
    const next = PROVIDERS.find(p => p.id === id)!;
    modelConnection.reset(); setManualModel(false);
    setSettings(s => ({ ...s, provider: next.id, connectionEnabled: true, rememberKey: false, connection: { ...s.connection, url: next.url, model: '', key: '' } }));
  }
  function disconnect() {
    modelConnection.reset(); setManualModel(false);
    setSettings(s => ({ ...s, connectionEnabled: false, rememberKey: false, connection: { ...s.connection, model: '', key: '' } }));
  }
  function testConnection() {
    setSettings(s => ({ ...s, connectionEnabled: true }));
    void modelConnection.test();
  }
  const snapshot = (): Draft => ({ source, output, manual, format, name, issues, stats: stats ?? undefined });
  const togglePanel = (p: Panel) => setPanel(current => current === p ? null : p);
  const clearReveal = () => { setOriginalReveal(undefined); setResultReveal(undefined); setChangeIndex(-1); };
  const invalidate = () => { setOutput(''); setProgress(null); setIssues([]); setStats(null); setStatus(''); clearReveal(); };
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
    if (!persistSettings(settings)) setNotice('Browser storage unavailable. Settings stay in this tab.');
  }, [settings]);
  useEffect(() => {
    if (!settings.saveDrafts) { remove('draft'); remove('history'); return; }
    if (busy) return;
    const timer = window.setTimeout(() => {
      if (!write('draft', snapshot()) || !write('history', history)) setNotice('Could not save locally. Download your draft to keep it.');
    }, 500);
    return () => clearTimeout(timer);
  }, [settings.saveDrafts, source, output, manual, format, name, issues, stats, history, busy]);
  useEffect(() => {
    if (panel) { dialog.current?.showModal(); }
    else dialog.current?.close();
  }, [panel]);
  useEffect(() => () => { abort.current?.abort(); }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); document.getElementById('run-edit')?.click(); }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, []);

  function replaceSource(value: string, newName?: string) {
    if (busyRef.current) return;
    clearReveal();
    setStats(null);
    setSource(value); setOutput(''); setManual([]); setProgress(null); setIssues([]); setSelection({ from: 0, to: 0 }); setStatus(''); setMobilePane('original');
    if (newName) setName(newName);
  }
  function changeSource(value: string, map: (ranges: Span[]) => Span[]) {
    if (value === sourceRef.current || busyRef.current) return;
    clearReveal();
    setStats(null);
    setSource(value); setManual(map); setOutput(''); setProgress(null); setIssues([]); setStatus('');
  }
  function modelReady() {
    if (settings.connectionEnabled === false || !settings.connection.model.trim()) { setPanel('connection'); setStatus('Choose a model to start.'); return false; }
    try { baseURL(settings.connection.url); return true; }
    catch (error) { setPanel('connection'); setStatus((error as Error).message); return false; }
  }
  async function run() {
    if (busyRef.current) { abort.current?.abort(); return; }
    if (!source.trim()) { setNotice('Paste or import a draft first.'); return; }
    if (!modelReady()) return;
    abort.current = new AbortController();
    clearReveal();
    busyRef.current = true; setBusy(true); setStatus(''); setNotice(''); setLeftTab('source'); setRightTab('changes'); setMobilePane('edited'); setProgress(null);
    setOutput(''); setIssues([]); setRetrying(null); setStats(null);
    let latestOutput = '', recoveryOutput = source, received = false;
    let latestIssues: Issue[] = [];
    let latestStats: GenerationStats | null = null;
    let lastPaint = 0, lastDone = -1, lastRetry = false;
    const started = { ...snapshot(), output: '' };
    try {
      const result = await editDocument(source, locks, { ...settings.connection }, settings.prompt, abort.current.signal, p => {
        recoveryOutput = p.text;
        latestIssues = p.issues;
        latestStats = p.stats;
        if (p.streamed) { received = true; modelConnection.streaming(); }
        const now = performance.now();
        if (now - lastPaint > 75 || p.done !== lastDone || p.retry !== lastRetry) {
          setOutput(p.preview); setProgress(p); setIssues(p.issues); setStats(p.stats); lastPaint = now; lastDone = p.done; lastRetry = p.retry;
        }
      });
      latestOutput = result.text;
      latestIssues = result.issues; setProgress(result);
      latestStats = result.stats;
      setStatus(result.total ? result.issues.length ? 'Edit complete. Review retained passages in Edited.' : 'Edit complete. Every lock checked.' : 'Everything is protected. Unlock a passage to edit it.');
    } catch (e) {
      latestOutput = received ? recoveryOutput : '';
      if (!abort.current.signal.aborted) modelConnection.failed(e);
      setStatus(abort.current.signal.aborted ? 'Stopped. Unfinished passages kept original.' : connectionError(e));
    } finally {
      busyRef.current = false; setBusy(false); setOutput(latestOutput); setIssues(latestIssues); setStats(latestStats);
      if (latestOutput) setHistory(h => [{ ...started, output: latestOutput, issues: latestIssues, stats: latestStats ?? undefined, at: Date.now(), id: crypto.randomUUID() }, ...h].slice(0, 12));
    }
  }
  async function retryOne(target: Issue) {
    if (busyRef.current || !modelReady()) return;
    const previous = snapshot(), previousIssues = issues;
    abort.current = new AbortController();
    const signal = abort.current.signal;
    busyRef.current = true; setBusy(true); setRetrying(target.from); setStatus(''); setNotice('');
    setStats(null);
    setRightTab('changes'); setMobilePane('edited');
    setResultReveal({ from: target.outputFrom, to: target.outputFrom, id: ++revealId.current });
    let lastPaint = 0, lastRetry = false;
    let latestStats: GenerationStats | null = null;
    try {
      const result = await retryPassage(source, output, locks, issues, target, { ...settings.connection }, settings.prompt, signal, update => {
        latestStats = update.stats;
        if (update.streamed) modelConnection.streaming();
        const now = performance.now();
        if (now - lastPaint > 75 || update.retry !== lastRetry) {
          setOutput(update.text); setIssues(update.issues); setStats(update.stats);
          setProgress(p => p ? { ...p, ...update, preview: update.text } : null);
          lastPaint = now; lastRetry = update.retry;
        }
      });
      setOutput(result.text); setIssues(result.issues);
      latestStats = result.stats;
      const kept = result.issues.find(issue => issue.from === target.from && issue.to === target.to);
      setStatus(kept ? 'Passage kept original. Review the reason in Edited.' : result.issues.length ? `Passage updated. ${result.issues.length} passage${result.issues.length === 1 ? ' still needs' : 's still need'} review.` : 'Passage updated. Every lock checked.');
      setResultReveal({ from: target.outputFrom, to: target.outputTo + result.text.length - previous.output.length, id: ++revealId.current });
      if (!kept) setHistory(h => [{ ...previous, output: result.text, issues: result.issues, stats: result.stats, at: Date.now(), id: crypto.randomUUID() }, ...h].slice(0, 12));
    } catch (error) {
      setOutput(previous.output); setIssues(previousIssues);
      setResultReveal({ from: target.outputFrom, to: target.outputTo, id: ++revealId.current });
      if (!signal.aborted && !(error instanceof PassageStateError)) modelConnection.failed(error);
      setStatus(signal.aborted ? 'Retry stopped. Previous result kept.' : connectionError(error));
    } finally {
      busyRef.current = false; setBusy(false); setRetrying(null);
      setStats(latestStats ?? previous.stats ?? null);
      setProgress(p => p ? { ...p, retry: false } : null);
    }
  }
  function lockRange(range: Span) {
    if (range.to > range.from && !busy && range.from >= 0 && range.to <= source.length) {
      setManual(m => m.some(r => r.from === range.from && r.to === range.to) ? m : [...m, range]);
      invalidate(); setSelection({ from: 0, to: 0 }); setNotice('Fact locked. Kept word for word.');
    }
  }
  const lockSelection = () => lockRange(selection);
  function locateOriginal(range: Span) {
    setOriginalReveal({ ...range, id: ++revealId.current }); setLeftTab('source'); setMobilePane('original');
  }
  function navigateChange(direction: number) {
    if (!diff.before.length) return;
    const next = changeIndex < 0 ? direction > 0 ? 0 : diff.before.length - 1 : (changeIndex + direction + diff.before.length) % diff.before.length;
    setChangeIndex(next); locateOriginal(diff.before[next]);
  }
  function locateRetained(issue: Issue) {
    setResultReveal({ from: issue.outputFrom, to: issue.outputTo, id: ++revealId.current });
    setRightTab('changes'); setMobilePane('edited');
    resultPanel.current?.scrollIntoView?.({ block: 'nearest' });
  }
  function preset(id: string) {
    const p = PRESETS.find(p => p.id === id)!;
    setSettings(s => ({ ...s, preset: p.id, prompt: p.prompt })); setFormat(p.format); setLeftTab('source'); invalidate();
  }
  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); setNotice('Copied.'); }
    catch { setNotice('Clipboard unavailable. Select the text and copy it.'); }
  }
  function download(value: string, edited = true) {
    const blob = new Blob([value], { type: format === 'markdown' ? 'text/markdown;charset=utf-8' : 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name.replace(/\.(md|txt)$/i, '') + (edited ? '.edited' : '') + (format === 'markdown' ? '.md' : '.txt'); a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function importFile(file?: File) {
    if (!file || busyRef.current) return;
    if (!/\.(md|txt)$/i.test(file.name)) { setNotice('Choose a .md or .txt file.'); return; }
    if (file.size > 2 * 1024 * 1024) { setNotice('Choose a file under 2 MB.'); return; }
    try {
      const content = await file.text();
      if (busyRef.current) return;
      replaceSource(content.replace(/^\uFEFF/, ''), file.name);
      const f = /\.md$/i.test(file.name) ? 'markdown' : 'text';
      preset(f === 'markdown' ? 'markdown' : 'light');
    } catch { setNotice('Could not read this file.'); }
  }
  function historyLoad(entry: Entry) {
    if (busy) return;
    clearReveal();
    setStats(entry.stats ?? null);
    setSource(entry.source); setOutput(entry.output); setManual(entry.manual); setFormat(entry.format); setName(draftTitle(entry.name)); setProgress(null); setIssues(entry.issues ?? []); setStatus('Restored from history.'); setPanel(null);
  }

  return <div className="app-shell">
    <header className="topbar">
      <a className="brand" href="./" aria-label="EditTrace home"><Logo /><span>Edit<span className="brand-light">Trace</span></span></a>
      <div className="top-actions">
        <button data-connection-state={modelConnection.phase} title={modelConnection.message || 'Configure your model connection'} className={'connection-pill ' + (connected ? 'connected' : '')} onClick={() => togglePanel('connection')} disabled={busy}><span className="dot" /><span className="connection-label">{settings.connection.model || 'Connect a model'}</span><ChevronDown size={13} /></button>
        <button className="icon-button" aria-label="History" title="History" onClick={() => togglePanel('history')} disabled={busy}><History size={18} /></button>
        <button className="icon-button theme-toggle" aria-label="Toggle theme" aria-pressed={settings.theme === 'dark'} title={settings.theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} onClick={() => setSettings(s => ({ ...s, theme: s.theme === 'dark' ? 'light' : 'dark' }))}>{settings.theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</button>
        <a className="github-link" href="https://github.com/rajmayank/EditTrace" target="_blank" rel="noreferrer">GitHub<ArrowUpRight size={13} /></a>
      </div>
    </header>

    <main>
      <div className="document-bar">
        <div className="document-title"><input aria-label="Document name" value={name} onChange={e => setName(e.target.value)} disabled={busy} /><span className="local-label">Your model. Your words.</span></div>
        <div className="document-actions"><button onClick={() => togglePanel('prompt')} disabled={busy}><Settings2 size={15} />Instructions</button><button onClick={() => togglePanel('help')}><CircleHelp size={16} /><span className="hide-small">Help</span></button><a className="feedback-button" aria-label="Give feedback" title="Give feedback on GitHub" href="https://github.com/rajmayank/EditTrace/issues/new" target="_blank" rel="noopener noreferrer"><MessageSquarePlus size={15} /><span className="hide-small">Feedback</span></a></div>
      </div>
      <div className="workspace-preferences">
        <div className="privacy-note"><ShieldCheck size={15} /><span><strong>No tracking. No server-side storage.</strong> Optional saves stay in your browser.</span></div>
        <label className="check-label save-drafts-control" title="Save this draft and edit history in your browser. When off, they stay in this tab."><input type="checkbox" checked={settings.saveDrafts} onChange={e => setSettings(s => ({ ...s, saveDrafts: e.target.checked }))} />Save drafts on this device</label>
      </div>
      <div className="workspace-controls">
        <div className="preset-control"><span className="small-label">EDIT FOR</span><select aria-label="Editing preset" value={settings.preset} disabled={busy} onChange={e => preset(e.target.value)}>{PRESETS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}<option value="custom" disabled>Custom instructions</option></select></div>
        <div className="protection-summary"><button className="lock-summary" onClick={() => togglePanel('locks')} disabled={busy}><ShieldCheck size={15} /><b>{locks.length}</b> protected<ChevronDown size={13} /></button><span className="divider" /><button className="text-button" disabled={selection.to <= selection.from || busy || leftTab !== 'source'} onMouseDown={e => e.preventDefault()} onClick={lockSelection}><Plus size={14} />Lock selection</button></div>
      </div>

      <div className="mobile-panes" role="group" aria-label="Editor panel">
        <button aria-pressed={mobilePane === 'original'} className={mobilePane === 'original' ? 'active' : ''} onClick={() => setMobilePane('original')}><span>01</span>Original</button>
        <button aria-pressed={mobilePane === 'edited'} className={mobilePane === 'edited' ? 'active' : ''} onClick={() => setMobilePane('edited')}><span>02</span>Edited{output && <i className="result-dot" />}</button>
      </div>
      <div className="workspace" data-mobile-pane={mobilePane} onScrollCapture={scrolling.onScrollCapture} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); void importFile(e.dataTransfer.files[0]); }}>
        <section className="editor-panel draft-panel" aria-label="Draft panel">
          <header className="panel-header"><div className="panel-title"><span className="panel-number">01</span><h1>Original</h1><ReadingStats estimate={originalReading} label="Original" /></div><div className="segmented" role="group" aria-label="Original view"><button className={leftTab === 'source' ? 'active' : ''} onClick={() => setLeftTab('source')}>Source</button><button className={leftTab === 'preview' ? 'active' : ''} onClick={() => setLeftTab('preview')} disabled={format !== 'markdown'}>Preview</button></div></header>
          <div className="editor-body">
            {leftTab === 'preview' ? <Preview value={source} scrollRef={scrolling.original} /> : <Editor label="Original draft" value={source} scrollRef={scrolling.original} readOnly={busy} isMarkdown={format === 'markdown'} locks={locks} changes={diff.before} changeKind="removed" onChange={changeSource} onSelection={setSelection} onLockSelection={lockRange} reveal={originalReveal} />}
            {!source && leftTab === 'source' && <div className="empty-draft"><span className="empty-eyebrow">START WITH YOUR DRAFT</span><p>Good writing starts here.</p><span>Paste your words, or drop a Markdown or text file.</span><button className="sample-button" disabled={busy} onClick={() => { preset('article'); replaceSource(SAMPLE, 'Connection limits.md'); }}>Try a sample <ArrowRight size={14} /></button></div>}
          </div>
          <footer className="panel-footer"><div className="footer-actions"><button onClick={async () => { try { const value = await navigator.clipboard.readText(); if (!busyRef.current) replaceSource(value); } catch { setNotice('Use ⌘V or Ctrl+V in the editor to paste.'); } }} disabled={busy}><Clipboard size={14} />Paste</button><button onClick={() => importRef.current?.click()} disabled={busy}><FileUp size={14} />Import</button><button className="icon-button" title="Download original" aria-label="Download original" onClick={() => download(source, false)} disabled={!source || busy}><Download size={14} /></button></div><span className="footer-meta">{format === 'markdown' ? 'Markdown' : format === 'email' ? 'Email' : 'Plain text'}<span className="dot-separator">·</span>{source.length.toLocaleString()} chars</span></footer>
        </section>
        <div className="middle-rail"><button className="scroll-link" aria-label="Link scrolling" aria-pressed={linkedScroll} title={linkedScroll ? 'Linked scrolling on. Click to scroll independently.' : 'Link scrolling between panes.'} disabled={!output} onClick={() => setSettings(s => ({ ...s, linkedScroll: !linkedScroll }))}>{linkedScroll ? <Link2 size={16} /> : <Unlink size={16} />}</button></div>
        <section ref={resultPanel} className="editor-panel result-panel" aria-label="Edited panel">
          <header className="panel-header"><div className="panel-title"><span className="panel-number">02</span><h2>Edited</h2>{output && <ReadingStats estimate={editedReading} label="Edited" />}</div><div className="segmented" role="group" aria-label="Edited view"><button className={rightTab === 'changes' ? 'active' : ''} onClick={() => setRightTab('changes')}>Changes</button><button className={rightTab === 'read' ? 'active' : ''} onClick={() => setRightTab('read')}>Read</button></div></header>
          <div className="editor-body">
            {output ? rightTab === 'read' && format === 'markdown' ? <Preview value={output} scrollRef={scrolling.edited} /> : <Editor label="Edited result" value={output} scrollRef={scrolling.edited} readOnly isMarkdown={format === 'markdown'} changes={rightTab === 'changes' ? diff.after : []} changeKind="added" retained={issues.map(issue => ({ from: issue.outputFrom, to: issue.outputTo }))} reveal={resultReveal} /> : busy ? <div className="waiting-result" role="status"><span className="spinner" />Waiting for your model…</div> : <div className="empty-result"><span className="empty-result-symbol"><FilePenLine size={27} strokeWidth={1.4} /></span><p>A little clearer.<br />Still yours.</p><span>Your edit will appear here, one passage at a time.</span><div className="diff-key"><span><i className="removed-key" />Removed</span><span><i className="added-key" />Added</span><span><i className="locked-key" />Protected</span></div></div>}
          </div>
          {!!issues.length && (!busy || retrying !== null) && <RetainedReview issues={issues} source={source} active={resultReveal} onLocate={locateRetained} onRetry={issue => void retryOne(issue)} retrying={retrying} />}
          <footer className="panel-footer"><div className="footer-actions"><button onClick={() => void copy(output)} disabled={!output || busy}><Copy size={14} />Copy</button><button onClick={() => download(output)} disabled={!output || busy}><Download size={14} />Export</button></div><button className="text-button" disabled={!output || busy} onClick={() => { if (window.confirm('Use this edit as the new draft?')) { replaceSource(output); } }}><Check size={14} />Use as draft</button></footer>
        </section>
      </div>

      <div className="edit-bar">
        <div className="edit-feedback"><div className="edit-status" role="status" aria-live="polite">{busy ? <><span className="spinner" />{retrying !== null ? progress?.retry ? 'Checking passage locks again' : 'Retrying passage' : progress?.retry ? 'Checking locks again' : 'Editing'}{retrying === null && <span className="muted">{progress?.done ?? 0}/{progress?.total ?? '…'} passages</span>}</> : status ? <><ShieldCheck size={15} /><span>{status}</span></> : <><LockKeyhole size={15} /><span>Select text to keep it word for word.</span></>}</div>{stats && <OutputRate stats={stats} active={busy} />}</div>
        <button id="run-edit" className={'primary-button ' + (busy ? 'stop-button' : '')} disabled={!busy && !source.trim()} onClick={() => void run()}>{busy ? <Square size={14} fill="currentColor" strokeWidth={0} /> : <Play size={15} fill="currentColor" />}{busy ? 'Stop' : 'Edit draft'}{!busy && <kbd>{shortcut} ↵</kbd>}</button>
      </div>
      {output && !busy && <div className="review-bar"><label className="check-label"><input type="checkbox" checked={showDiff} onChange={e => setShowDiff(e.target.checked)} />Show changes</label><div className="change-navigation"><span>{diff.before.length} removals · {diff.after.length} additions</span><button aria-label="Previous change" disabled={!diff.before.length} onClick={() => navigateChange(-1)}><ChevronLeft size={15} /></button><button aria-label="Next change" disabled={!diff.before.length} onClick={() => navigateChange(1)}><ChevronRight size={15} /></button></div></div>}
      <footer className="app-footer"><span className="attribution">Built and maintained by <a href="https://mayankraj.com" target="_blank" rel="noreferrer">Mayank Raj</a></span><div className="footer-links"><a href="https://github.com/rajmayank/EditTrace" target="_blank" rel="noreferrer">GitHub repo<ArrowUpRight size={11} /></a><span>Apache 2.0</span></div></footer>
    </main>
    {notice && <div className="toast" role="status"><span>{notice}</span><button aria-label="Dismiss notification" onClick={() => setNotice('')}><X size={14} /></button></div>}
    <input ref={importRef} type="file" hidden accept=".md,.txt,text/plain,text/markdown" onChange={e => { void importFile(e.target.files?.[0]); e.target.value = ''; }} />

    <dialog ref={dialog} onCancel={() => { setPanel(null); }} onClick={e => { if (e.target === dialog.current) setPanel(null); }}>
      <div className="dialog-inner"><header className="dialog-header"><div><span className="small-label">EDITTRACE</span><h2>{panel === 'connection' ? 'Connect your model' : panel === 'prompt' ? 'Editing instructions' : panel === 'locks' ? 'Protected passages' : panel === 'history' ? 'Recent edits' : 'A short guide'}</h2></div><button className="icon-button" aria-label="Close dialog" onClick={() => setPanel(null)}><X size={19} /></button></header>
        {panel === 'connection' && <div className="dialog-content connection-content">
          <p className="dialog-description connection-privacy">No background service. Your browser connects directly to your model provider. API keys stay in your browser and are sent only to that provider.</p>
          <div className="provider-presets" role="group" aria-label="Provider presets">{PROVIDERS.map(p => <button key={p.id} aria-pressed={provider.id === p.id} onClick={() => chooseProvider(p.id)}>{p.name}</button>)}</div>
          <label>Server URL<input type="url" value={settings.connection.url} placeholder="https://your-server.example/v1" onChange={e => setConnection({ url: e.target.value })} /></label>
          <label>API key <span className="muted">{provider.keyRequired ? 'required' : 'optional'}</span><input type="password" autoComplete="off" value={settings.connection.key} onChange={e => setConnection({ key: e.target.value })} /></label>
          <label className="check-label"><input type="checkbox" checked={settings.rememberKey} onChange={e => setSettings(s => ({ ...s, rememberKey: e.target.checked }))} />Remember API key on this device</label>
          <div className="connection-test-row"><button className="secondary-button connection-test" onClick={testConnection} disabled={testing}>{testing ? <span className="spinner" /> : <Unplug size={15} />}{testing ? 'Testing connection…' : 'Test connection'}</button>{(connected || settings.connection.model || settings.connection.key || testing) && <button className="text-button disconnect-button" onClick={disconnect}><Unplug size={14} />Disconnect</button>}</div>
          <div className={'connection-result ' + modelConnection.phase} role={modelConnection.phase === 'error' ? 'alert' : 'status'} aria-live="polite">{testing ? <span className="spinner" /> : connected ? <CircleCheck size={17} /> : modelConnection.phase === 'error' ? <CircleAlert size={17} /> : <Unplug size={17} />}<span>{modelConnection.message || 'Test your connection to discover available models.'}</span></div>
          <div className="model-field"><label>Default model{models.length && !manualModel ? <select value={settings.connection.model} onChange={e => setConnection({ model: e.target.value })}>{models.map(m => <option key={m} value={m}>{m}</option>)}</select> : <input value={settings.connection.model} placeholder="Enter the model identifier" onChange={e => setConnection({ model: e.target.value })} />}</label>{!!models.length && <button className="text-button" onClick={() => setManualModel(s => !s)}>{manualModel ? 'Choose discovered model' : 'Enter model ID manually'}</button>}</div>
          <div className="field-row"><label>Temperature<input type="number" min="0" max="2" step="0.1" value={settings.connection.temperature} onChange={e => setConnection({ temperature: Math.min(2, Math.max(0, Number(e.target.value))) })} /></label><label>Output tokens per passage<input type="number" min="256" max="32768" step="256" value={settings.connection.maxTokens} onChange={e => setConnection({ maxTokens: Math.min(32768, Math.max(256, Number(e.target.value))) })} /></label></div>
          <p className="provider-help">{provider.help} {provider.docs && <a href={provider.docs} target="_blank" rel="noreferrer">Setup guide<ArrowUpRight size={11} /></a>}</p>
          <button className="primary-button full" onClick={() => setPanel(null)}>Done<Check size={15} /></button>
        </div>}
        {panel === 'prompt' && <div className="dialog-content"><div className="preset-chips">{PRESETS.map(p => <button key={p.id} className={settings.preset === p.id ? 'selected' : ''} onClick={() => preset(p.id)}>{p.name}</button>)}</div><label>System prompt<textarea className="prompt-textarea" value={settings.prompt} onChange={e => setSettings(s => ({ ...s, preset: 'custom', prompt: e.target.value }))} /></label><p className="dialog-description">Applied to every passage. Lock checks run after generation.</p><div className="field-row"><button className="secondary-button" onClick={() => preset('article')}><RotateCcw size={14} />Reset</button><button className="primary-button" onClick={() => setPanel(null)}>Done<Check size={15} /></button></div></div>}
        {panel === 'locks' && <div className="dialog-content"><div className="protection-helper" role="note"><ShieldCheck size={17} /><p>Protected text stays word for word. Use it for exact facts and formatting. Select custom facts in Source and choose <b>Lock as fact</b>.</p></div><label>Document type<select value={format} onChange={e => { setFormat(e.target.value as Format); setLeftTab('source'); invalidate(); }}><option value="markdown">Markdown</option><option value="email">Email</option><option value="text">Plain text</option></select></label><div className="lock-options">{([['structure', 'Structure & notation', 'Preserves Markdown notation, code blocks, tables, front matter, and line breaks. Heading wording stays editable.'], ['inline', 'Code & links', 'Preserves inline code, full links including labels, addresses, and math. Use for commands and references.'], ['numbers', 'Numbers', 'Preserves numbers, dates, percentages, and numeric limits. Use for figures that must stay exact.'], ['signature', 'Email signature', 'Preserves detected signatures and quoted threads in Email mode. Lock unusual signatures manually.']] as const).map(([key, title, description]) => <label className="rule-toggle" key={key}><input type="checkbox" checked={settings.locks[key]} onChange={e => { setSettings(s => ({ ...s, locks: { ...s.locks, [key]: e.target.checked } })); invalidate(); }} /><span><b>{title}</b><small>{description}</small></span></label>)}</div><div className="lock-list">{manual.map((r, i) => <div key={i}><LockKeyhole size={13} /><span>{source.slice(r.from, r.to)}</span><button aria-label={'Remove lock ' + (i + 1)} onClick={() => { setManual(m => m.filter((_, j) => j !== i)); invalidate(); }}><X size={13} /></button></div>)}{!manual.length && <p className="muted">Select a passage in Source, then choose Lock as fact.</p>}</div><span className="muted">{locks.length} protected ranges. Check the blue highlights in Source before editing.</span><button className="primary-button full" onClick={() => setPanel(null)}>Done<Check size={15} /></button></div>}
        {panel === 'history' && <div className="dialog-content"><div className="history-head"><span className="muted">{settings.saveDrafts ? 'Saved on this device.' : 'This tab only.'} Up to 12 edits.</span><button className="text-button" disabled={!history.length} onClick={() => { setHistory([]); remove('history'); }}><Trash2 size={14} />Clear</button></div>{history.length ? history.map(h => <button key={h.id} className="history-entry" onClick={() => historyLoad(h)}><span><b>{h.name}</b><small>{new Date(h.at).toLocaleString()} · {estimateReading(h.source, h.format).words} words</small></span><ArrowRight size={16} /></button>) : <div className="history-empty"><History size={25} /><p>Your edits will appear here.</p></div>}</div>}
        {panel === 'help' && <div className="dialog-content help-content"><p>Connect a model, paste a draft, and choose an editing preset. Select any text in Source and choose <b>Lock as fact</b> to keep it unchanged.</p><p><b>Markdown</b> keeps recognized code blocks, tables, heading markers, links, and line breaks. Heading wording stays editable. <b>Email</b> detects common signatures. Protected text is blue.</p><p>Each passage is checked after generation. A failed check gets one retry. If it still fails, the original passage stays. In Edited, choose <b>Show passage</b> to locate it or <b>Retry</b> to run just that passage again. Other edits stay in place.</p><p>Read the result before using it. Text outside locks can still change meaning. Use a model that follows system instructions and copies markers accurately.</p><p>Your draft goes directly to the server you choose. Settings stay in this browser; saving drafts and API keys is optional. Preview does not load external images.</p><p><b>Connection trouble?</b> Enable CORS, allow the browser’s local-network permission, and check your server address. Use HTTPS for a remote server. If your browser blocks a local connection from GitHub Pages, run EditTrace locally with <code>npm run dev</code>.</p><a href="https://github.com/rajmayank/EditTrace" target="_blank" rel="noreferrer" className="source-link">Source & setup<ArrowUpRight size={13} /></a></div>}
      </div>
    </dialog>
  </div>;
}
