import { useEffect, useMemo, useRef, useState } from 'react';
import { diffWordsWithSpace } from 'diff';
import { ArrowRight, Check, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Clipboard, Copy, Download, FileUp, History, LockKeyhole, Moon, Play, Plus, RotateCcw, Settings2, ShieldCheck, Square, Sun, Trash2, Unplug, X } from 'lucide-react';
import { Editor } from './Editor';
import { Preview } from './Preview';
import { autoLocks } from './core/protection';
import { baseURL, listModels, networkHelp } from './core/api';
import { editDocument, type Progress } from './core/engine';
import { DEFAULT_LOCKS, type Connection, type Format, type Span } from './core/types';
import { PRESETS, SAMPLE } from './core/presets';
import { persistSettings, read, remove, write, type Draft, type SavedSettings } from './core/storage';

const DEFAULT_CONNECTION: Connection = { url: 'http://localhost:1234/v1', model: '', key: '', temperature: 0.3, maxTokens: 4096 };
const defaults: SavedSettings = { connection: DEFAULT_CONNECTION, rememberKey: false, saveDrafts: false, theme: 'light', preset: 'article', prompt: PRESETS[0].prompt, locks: DEFAULT_LOCKS };
type Entry = Draft & { at: number; id: string };
type Panel = 'connection' | 'prompt' | 'locks' | 'history' | 'help' | null;
const words = (s: string) => s.trim() ? s.trim().split(/\s+/u).length : 0;

export default function App() {
  const [settings, setSettings] = useState(() => {
    const s = read<Partial<SavedSettings>>('settings', {});
    return { ...defaults, ...s, connection: { ...DEFAULT_CONNECTION, ...s.connection }, locks: { ...DEFAULT_LOCKS, ...s.locks } };
  });
  const [initial] = useState(() => settings.saveDrafts ? read<Draft | null>('draft', null) : null);
  const [source, setSource] = useState(initial?.source ?? '');
  const [output, setOutput] = useState(initial?.output ?? '');
  const [format, setFormat] = useState<Format>(initial?.format ?? 'markdown');
  const [name, setName] = useState(initial?.name ?? 'Untitled draft');
  const [manual, setManual] = useState<Span[]>(initial?.manual ?? []);
  const [selection, setSelection] = useState<Span>({ from: 0, to: 0 });
  const [progress, setProgress] = useState<Progress | null>(null);
  const [busy, setBusy] = useState(false), [testing, setTesting] = useState(false);
  const [status, setStatus] = useState(''), [notice, setNotice] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [tested, setTested] = useState('');
  const [panel, setPanel] = useState<Panel>(null);
  const [leftTab, setLeftTab] = useState('source'), [rightTab, setRightTab] = useState('changes');
  const [showDiff, setShowDiff] = useState(true), [scroll, setScroll] = useState<number | undefined>();
  const [changeIndex, setChangeIndex] = useState(0);
  const [history, setHistory] = useState<Entry[]>(() => settings.saveDrafts ? read<Entry[]>('history', []) : []);
  const abort = useRef<AbortController | null>(null), testAbort = useRef<AbortController | null>(null);
  const busyRef = useRef(false), importRef = useRef<HTMLInputElement>(null), dialog = useRef<HTMLDialogElement>(null);
  const settingsRef = useRef(settings); settingsRef.current = settings;
  const sourceRef = useRef(source); sourceRef.current = source;
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
  const setConnection = (patch: Partial<Connection>) => { setSettings(s => ({ ...s, connection: { ...s.connection, ...patch } })); setTested(''); };
  const snapshot = (): Draft => ({ source, output, manual, format, name });
  const togglePanel = (p: Panel) => setPanel(current => current === p ? null : p);
  const invalidate = () => { setOutput(''); setProgress(null); setStatus(''); };
  useEffect(() => {
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
  }, [settings.saveDrafts, source, output, manual, format, name, history, busy]);
  useEffect(() => {
    if (panel) { dialog.current?.showModal(); }
    else dialog.current?.close();
  }, [panel]);
  useEffect(() => () => { abort.current?.abort(); testAbort.current?.abort(); }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); document.getElementById('run-edit')?.click(); }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, []);

  function replaceSource(value: string, newName?: string) {
    if (busyRef.current) return;
    setSource(value); setOutput(''); setManual([]); setProgress(null); setSelection({ from: 0, to: 0 }); setStatus('');
    if (newName) setName(newName);
  }
  function changeSource(value: string, map: (ranges: Span[]) => Span[]) {
    if (value === sourceRef.current || busyRef.current) return;
    setSource(value); setManual(map); setOutput(''); setProgress(null); setStatus('');
  }
  async function test() {
    if (testing) return;
    testAbort.current = new AbortController();
    setTesting(true); setStatus('');
    const c = { ...settings.connection };
    try {
      baseURL(c.url);
      const found = await listModels(c, testAbort.current.signal);
      if (settingsRef.current.connection.url !== c.url || settingsRef.current.connection.key !== c.key) return;
      setModels(found); setTested(c.url + c.key);
      setSettings(s => ({ ...s, connection: { ...s.connection, model: found.includes(s.connection.model) ? s.connection.model : found[0] } }));
      setStatus(`Connected. ${found.length} model${found.length === 1 ? '' : 's'} available.`);
    } catch (e) { if (!testAbort.current.signal.aborted) setStatus(e instanceof TypeError ? networkHelp : e instanceof Error ? e.message : 'Connection failed.'); }
    finally { setTesting(false); }
  }
  async function run() {
    if (busyRef.current) { abort.current?.abort(); return; }
    if (!source.trim()) { setNotice('Paste or import a draft first.'); return; }
    if (!settings.connection.model.trim()) { setPanel('connection'); setStatus('Choose a model to start.'); return; }
    try { baseURL(settings.connection.url); } catch (e) { setPanel('connection'); setStatus((e as Error).message); return; }
    abort.current = new AbortController();
    busyRef.current = true; setBusy(true); setStatus(''); setNotice(''); setLeftTab('source'); setRightTab('changes'); setProgress(null);
    let latestOutput = source;
    let lastPaint = 0, lastDone = -1, lastRetry = false;
    const started = { ...snapshot(), output: source };
    try {
      const result = await editDocument(source, locks, { ...settings.connection }, settings.prompt, abort.current.signal, p => {
        latestOutput = p.text;
        const now = performance.now();
        if (now - lastPaint > 75 || p.done !== lastDone || p.retry !== lastRetry) {
          setOutput(p.text); setProgress(p); lastPaint = now; lastDone = p.done; lastRetry = p.retry;
        }
      });
      latestOutput = result.text;
      setStatus(result.total ? result.issues.length ? `${result.issues.length} passage${result.issues.length === 1 ? '' : 's'} kept original. Review below.` : 'Edit complete. Every lock checked.' : 'Everything is protected. Unlock a passage to edit it.');
    } catch (e) {
      setStatus(abort.current.signal.aborted ? 'Stopped. Unfinished passages kept original.' : e instanceof TypeError ? networkHelp : e instanceof Error ? e.message : 'Editing failed.');
    } finally {
      busyRef.current = false; setBusy(false); setOutput(latestOutput);
      setHistory(h => [{ ...started, output: latestOutput, at: Date.now(), id: crypto.randomUUID() }, ...h].slice(0, 12));
    }
  }
  function lockSelection() {
    if (selection.to > selection.from && !busy) { setManual(m => [...m, selection]); invalidate(); setNotice('Selection protected.'); }
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
    setSource(entry.source); setOutput(entry.output); setManual(entry.manual); setFormat(entry.format); setName(entry.name); setProgress(null); setStatus('Restored from history.'); setPanel(null);
  }
  const connected = tested === settings.connection.url + settings.connection.key;
  const issues = progress?.issues ?? [];

  return <div className="app-shell">
    <header className="topbar">
      <a className="brand" href="./" aria-label="EditTrace home"><span className="brand-mark"><span /><span /><span /></span><span>Edit<span className="brand-light">Trace</span></span><span className="beta">0.1</span></a>
      <div className="top-actions">
        <button className={'connection-pill ' + (connected ? 'connected' : '')} onClick={() => togglePanel('connection')} disabled={busy}><span className="dot" />{settings.connection.model || 'Connect a model'}<ChevronDown size={13} /></button>
        <button className="icon-button" aria-label="History" title="History" onClick={() => togglePanel('history')} disabled={busy}><History size={18} /></button>
        <button className="icon-button" aria-label="Toggle theme" title="Toggle theme" onClick={() => setSettings(s => ({ ...s, theme: s.theme === 'dark' ? 'light' : 'dark' }))}>{settings.theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</button>
        <a className="github-link" href="https://github.com/rajmayank/EditTrace" target="_blank" rel="noreferrer">GitHub ↗</a>
      </div>
    </header>

    <main>
      <div className="document-bar">
        <div className="document-title"><input aria-label="Document name" value={name} onChange={e => setName(e.target.value)} disabled={busy} /><span className="local-label">Your model. Your words.</span></div>
        <div className="document-actions"><button onClick={() => togglePanel('prompt')} disabled={busy}><Settings2 size={15} />Instructions</button><button onClick={() => togglePanel('help')}><CircleHelp size={16} /><span className="hide-small">Help</span></button></div>
      </div>
      <div className="workspace-controls">
        <div className="preset-control"><span className="small-label">EDIT FOR</span><select aria-label="Editing preset" value={settings.preset} disabled={busy} onChange={e => preset(e.target.value)}>{PRESETS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}<option value="custom" disabled>Custom instructions</option></select></div>
        <div className="protection-summary"><button className="lock-summary" onClick={() => togglePanel('locks')} disabled={busy}><ShieldCheck size={15} /><b>{locks.length}</b> protected<ChevronDown size={13} /></button><span className="divider" /><button className="text-button" disabled={selection.to <= selection.from || busy || leftTab !== 'source'} onMouseDown={e => e.preventDefault()} onClick={lockSelection}><Plus size={14} />Lock selection</button></div>
      </div>

      <div className="workspace" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); void importFile(e.dataTransfer.files[0]); }}>
        <section className="editor-panel draft-panel" aria-label="Draft panel">
          <header className="panel-header"><div className="panel-title"><span className="panel-number">01</span><h1>Original</h1><span className="word-count">{words(source).toLocaleString()} words</span></div><div className="segmented" role="group" aria-label="Original view"><button className={leftTab === 'source' ? 'active' : ''} onClick={() => setLeftTab('source')}>Source</button><button className={leftTab === 'preview' ? 'active' : ''} onClick={() => setLeftTab('preview')} disabled={format !== 'markdown'}>Preview</button></div></header>
          <div className="editor-body">
            {leftTab === 'preview' ? <Preview value={source} /> : <Editor label="Original draft" value={source} readOnly={busy} isMarkdown={format === 'markdown'} locks={locks} changes={diff.before} changeKind="removed" onChange={changeSource} onSelection={setSelection} scrollTo={scroll} />}
            {!source && leftTab === 'source' && <div className="empty-draft"><span className="empty-eyebrow">START WITH YOUR DRAFT</span><p>Good writing starts here.</p><span>Paste your words, or drop a Markdown or text file.</span><button className="sample-button" disabled={busy} onClick={() => { preset('article'); replaceSource(SAMPLE, 'Connection limits.md'); }}>Try a sample <ArrowRight size={14} /></button></div>}
          </div>
          <footer className="panel-footer"><div className="footer-actions"><button onClick={async () => { try { const value = await navigator.clipboard.readText(); if (!busyRef.current) replaceSource(value); } catch { setNotice('Use ⌘V or Ctrl+V in the editor to paste.'); } }} disabled={busy}><Clipboard size={14} />Paste</button><button onClick={() => importRef.current?.click()} disabled={busy}><FileUp size={14} />Import</button><button className="icon-button" title="Download original" aria-label="Download original" onClick={() => download(source, false)} disabled={!source || busy}><Download size={14} /></button></div><span className="footer-meta">{format === 'markdown' ? 'Markdown' : format === 'email' ? 'Email' : 'Plain text'}<span className="dot-separator">·</span>{source.length.toLocaleString()} chars</span></footer>
        </section>
        <div className="middle-rail"><span><ArrowRight size={18} /></span></div>
        <section className="editor-panel result-panel" aria-label="Edited panel">
          <header className="panel-header"><div className="panel-title"><span className="panel-number">02</span><h2>Edited</h2><span className="word-count">{output ? words(output).toLocaleString() + ' words' : ''}</span></div><div className="segmented" role="group" aria-label="Edited view"><button className={rightTab === 'changes' ? 'active' : ''} onClick={() => setRightTab('changes')}>Changes</button><button className={rightTab === 'read' ? 'active' : ''} onClick={() => setRightTab('read')}>Read</button></div></header>
          <div className="editor-body">
            {output ? rightTab === 'read' && format === 'markdown' ? <Preview value={output} /> : <Editor label="Edited result" value={output} readOnly isMarkdown={format === 'markdown'} changes={rightTab === 'changes' ? diff.after : []} changeKind="added" /> : <div className="empty-result"><span className="empty-result-symbol"><Settings2 size={28} strokeWidth={1.3} /></span><p>A little clearer.<br />Still yours.</p><span>Your edit will appear here, one passage at a time.</span><div className="diff-key"><span><i className="removed-key" />Removed</span><span><i className="added-key" />Added</span><span><i className="locked-key" />Protected</span></div></div>}
          </div>
          <footer className="panel-footer"><div className="footer-actions"><button onClick={() => void copy(output)} disabled={!output || busy}><Copy size={14} />Copy</button><button onClick={() => download(output)} disabled={!output || busy}><Download size={14} />Export</button></div><button className="text-button" disabled={!output || busy} onClick={() => { if (window.confirm('Use this edit as the new draft?')) { replaceSource(output); } }}><Check size={14} />Use as draft</button></footer>
        </section>
      </div>

      <div className="edit-bar">
        <div className="edit-status" role="status" aria-live="polite">{busy ? <><span className="spinner" />{progress?.retry ? 'Checking locks again' : 'Editing'}<span className="muted">{progress?.done ?? 0}/{progress?.total ?? '…'} passages</span></> : status ? <><ShieldCheck size={15} /><span>{status}</span></> : <><LockKeyhole size={15} /><span>Select text to keep it word for word.</span></>}</div>
        <button id="run-edit" className={'primary-button ' + (busy ? 'stop-button' : '')} disabled={!busy && !source.trim()} onClick={() => void run()}>{busy ? <Square size={15} /> : <Play size={15} fill="currentColor" />}{busy ? 'Stop' : 'Edit draft'}{!busy && <kbd>⌘ ↵</kbd>}</button>
      </div>
      {output && !busy && <div className="review-bar"><label className="check-label"><input type="checkbox" checked={showDiff} onChange={e => setShowDiff(e.target.checked)} />Show changes</label><div className="change-navigation"><span>{diff.before.length} removals · {diff.after.length} additions</span><button aria-label="Previous change" disabled={!diff.before.length} onClick={() => { const n = (changeIndex - 1 + diff.before.length) % diff.before.length; setChangeIndex(n); setScroll(diff.before[n].from); setLeftTab('source'); }}><ChevronLeft size={15} /></button><button aria-label="Next change" disabled={!diff.before.length} onClick={() => { const n = (changeIndex + 1) % diff.before.length; setChangeIndex(n); setScroll(diff.before[n].from); setLeftTab('source'); }}><ChevronRight size={15} /></button></div></div>}
      {!!issues.length && !busy && <div className="issue-list" aria-label="Passages needing review">{issues.map((issue, i) => <button key={i} onClick={() => { setScroll(issue.from); setLeftTab('source'); }}><ShieldCheck size={15} /><strong>Passage kept</strong><span>{issue.message}</span><ArrowRight size={14} /></button>)}</div>}
      <footer className="app-footer"><span>Browser to model. No relay.</span><label className="check-label"><input type="checkbox" checked={settings.saveDrafts} onChange={e => setSettings(s => ({ ...s, saveDrafts: e.target.checked }))} />Save drafts on this device</label><span>Apache 2.0</span></footer>
    </main>
    {notice && <div className="toast" role="status"><span>{notice}</span><button aria-label="Dismiss notification" onClick={() => setNotice('')}><X size={14} /></button></div>}
    <input ref={importRef} type="file" hidden accept=".md,.txt,text/plain,text/markdown" onChange={e => { void importFile(e.target.files?.[0]); e.target.value = ''; }} />

    <dialog ref={dialog} onCancel={() => { setPanel(null); }} onClick={e => { if (e.target === dialog.current) setPanel(null); }}>
      <div className="dialog-inner"><header className="dialog-header"><div><span className="small-label">EDITTRACE</span><h2>{panel === 'connection' ? 'Connect your model' : panel === 'prompt' ? 'Editing instructions' : panel === 'locks' ? 'Protected passages' : panel === 'history' ? 'Recent edits' : 'A short guide'}</h2></div><button className="icon-button" aria-label="Close dialog" onClick={() => setPanel(null)}><X size={19} /></button></header>
        {panel === 'connection' && <div className="dialog-content">
          <p className="dialog-description">LM Studio or any OpenAI-compatible server.</p>
          <label>Server URL<input type="url" value={settings.connection.url} placeholder="http://localhost:1234/v1" onChange={e => setConnection({ url: e.target.value })} /></label>
          <div className="field-row"><label>API key <span className="muted">optional</span><input type="password" autoComplete="off" value={settings.connection.key} onChange={e => setConnection({ key: e.target.value })} /></label><button className="secondary-button connection-test" onClick={() => void test()} disabled={testing}>{testing ? <span className="spinner" /> : <Unplug size={15} />}{testing ? 'Testing' : 'Test connection'}</button></div>
          <label className="check-label"><input type="checkbox" checked={settings.rememberKey} onChange={e => setSettings(s => ({ ...s, rememberKey: e.target.checked }))} />Remember API key on this device</label>
          <label>Default model<input list="model-options" value={settings.connection.model} placeholder="Test connection to discover models" onChange={e => setConnection({ model: e.target.value })} /><datalist id="model-options">{models.map(m => <option key={m} value={m} />)}</datalist></label>
          <div className="field-row"><label>Temperature<input type="number" min="0" max="2" step="0.1" value={settings.connection.temperature} onChange={e => setConnection({ temperature: Math.min(2, Math.max(0, Number(e.target.value))) })} /></label><label>Output tokens per passage<input type="number" min="256" max="32768" step="256" value={settings.connection.maxTokens} onChange={e => setConnection({ maxTokens: Math.min(32768, Math.max(256, Number(e.target.value))) })} /></label></div>
          <p className="inline-status" role="status">{status || 'Enable CORS on the server. Allow local-network access if your browser asks. Use HTTPS for remote servers.'}</p>
          <button className="primary-button full" onClick={() => setPanel(null)}>Done<Check size={15} /></button>
        </div>}
        {panel === 'prompt' && <div className="dialog-content"><div className="preset-chips">{PRESETS.map(p => <button key={p.id} className={settings.preset === p.id ? 'selected' : ''} onClick={() => preset(p.id)}>{p.name}</button>)}</div><label>System prompt<textarea className="prompt-textarea" value={settings.prompt} onChange={e => setSettings(s => ({ ...s, preset: 'custom', prompt: e.target.value }))} /></label><p className="dialog-description">Applied to every passage. Lock checks run after generation.</p><div className="field-row"><button className="secondary-button" onClick={() => preset('article')}><RotateCcw size={14} />Reset</button><button className="primary-button" onClick={() => setPanel(null)}>Done<Check size={15} /></button></div></div>}
        {panel === 'locks' && <div className="dialog-content"><p className="dialog-description">Automatic rules plus any text you select and lock.</p><label>Document type<select value={format} onChange={e => { setFormat(e.target.value as Format); setLeftTab('source'); invalidate(); }}><option value="markdown">Markdown</option><option value="email">Email</option><option value="text">Plain text</option></select></label><div className="lock-options">{([['structure', 'Structure & notation', 'Blocks, markers, and line breaks'], ['inline', 'Code & links', 'Inline code, addresses, and link notation'], ['numbers', 'Numbers', 'Values, dates, and percentages'], ['signature', 'Email signature', 'Closing and quoted thread']] as const).map(([key, title, description]) => <label className="rule-toggle" key={key}><input type="checkbox" checked={settings.locks[key]} onChange={e => { setSettings(s => ({ ...s, locks: { ...s.locks, [key]: e.target.checked } })); invalidate(); }} /><span><b>{title}</b><small>{description}</small></span></label>)}</div><div className="lock-list">{manual.map((r, i) => <div key={i}><LockKeyhole size={13} /><span>{source.slice(r.from, r.to)}</span><button aria-label={'Remove lock ' + (i + 1)} onClick={() => { setManual(m => m.filter((_, j) => j !== i)); invalidate(); }}><X size={13} /></button></div>)}{!manual.length && <p className="muted">Select a passage in Source, then choose Lock selection.</p>}</div><span className="muted">{locks.length} protected ranges. Signatures are detected in Email mode; select unusual signatures manually.</span><button className="primary-button full" onClick={() => setPanel(null)}>Done<Check size={15} /></button></div>}
        {panel === 'history' && <div className="dialog-content"><div className="history-head"><span className="muted">{settings.saveDrafts ? 'Saved on this device.' : 'This tab only.'} Up to 12 edits.</span><button className="text-button" disabled={!history.length} onClick={() => { setHistory([]); remove('history'); }}><Trash2 size={14} />Clear</button></div>{history.length ? history.map(h => <button key={h.id} className="history-entry" onClick={() => historyLoad(h)}><span><b>{h.name}</b><small>{new Date(h.at).toLocaleString()} · {words(h.source)} words</small></span><ArrowRight size={16} /></button>) : <div className="history-empty"><History size={25} /><p>Your edits will appear here.</p></div>}</div>}
        {panel === 'help' && <div className="dialog-content help-content"><p>Connect a model, paste a draft, and choose an editing preset. Select text and click <b>Lock selection</b> to keep it unchanged.</p><p><b>Markdown</b> keeps recognized code blocks, headings, tables, markers, links, and line breaks. <b>Email</b> detects common signatures. Protected text is blue.</p><p>Each passage is checked after generation. A failed check gets one retry. If it still fails, the original passage stays and is flagged.</p><p>Read the result before using it. Text outside locks can still change meaning. Use a model that follows system instructions and copies markers accurately.</p><p>Your draft goes directly to the server you choose. Settings stay in this browser; saving drafts and API keys is optional. Preview does not load external images.</p><p><b>Connection trouble?</b> Enable CORS, allow the browser’s local-network permission, and check your server address. Use HTTPS for a remote server. If your browser blocks a local connection from GitHub Pages, run EditTrace locally with <code>npm run dev</code>.</p><a href="https://github.com/rajmayank/EditTrace" target="_blank" rel="noreferrer">Source & setup ↗</a></div>}
      </div>
    </dialog>
  </div>;
}
