import type { Connection } from './types';

export function baseURL(raw: string): string {
  const u = new URL(raw);
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash) throw new Error('Use an HTTP(S) server URL without credentials or query parameters.');
  u.pathname = u.pathname.replace(/\/(?:chat\/completions|models)\/?$/, '').replace(/\/+$/, '') || '/v1';
  return u.toString().replace(/\/$/, '');
}
function headers(key: string) { return { 'Content-Type': 'application/json', ...(key ? { Authorization: 'Bearer ' + key } : {}) }; }
function errorText(status: number) {
  if (status === 401 || status === 403) return 'Authentication failed. Check the API key.';
  if (status === 404) return 'Endpoint or model not found. Check the server URL and model.';
  return `Server returned ${status}. Check the model server logs and context limit.`;
}
export const networkHelp = 'Could not reach the server. Check its address, CORS, and browser local-network permission. Remote servers need HTTPS from GitHub Pages.';
export function connectionError(error: unknown) {
  const known = error instanceof Error || error instanceof DOMException;
  if (known && (error.name === 'TimeoutError' || /timed? ?out/i.test(error.message))) return 'Connection timed out. Check that the server is running and reachable.';
  if (error instanceof TypeError && /fetch|network|load failed/i.test(error.message)) return networkHelp;
  return known ? error.message : 'Connection failed. Check the server address.';
}

export async function listModels(c: Connection, signal?: AbortSignal): Promise<string[]> {
  const response = await fetch(baseURL(c.url) + '/models', { headers: headers(c.key), signal: AbortSignal.any([AbortSignal.timeout(12000), ...(signal ? [signal] : [])]) });
  if (!response.ok) throw new Error(errorText(response.status));
  const data = await response.json();
  if (!data || !Array.isArray(data.data)) throw new Error('This server did not return a model list. Use an OpenAI-compatible endpoint.');
  const ids = [...new Set<string>(data.data.map((m: { id?: unknown } | null) => m?.id).filter((id: unknown): id is string => typeof id === 'string'))];
  if (!ids.length) throw new Error('No models available. Load a model in your server first.');
  return ids;
}

export async function complete(c: Connection, system: string, draft: string, signal: AbortSignal, onText: (text: string) => void): Promise<string> {
  const response = await fetch(baseURL(c.url) + '/chat/completions', {
    method: 'POST', headers: headers(c.key), signal,
    body: JSON.stringify({ model: c.model, messages: [{ role: 'system', content: system }, { role: 'user', content: draft }], temperature: c.temperature, max_tokens: c.maxTokens, stream: true }),
  });
  if (!response.ok) throw new Error(errorText(response.status));
  if (!response.body) throw new Error('The server returned an empty stream.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', output = '', event: string[] = [], finished = false;
  const dispatch = () => {
    if (!event.length) return;
    const data = event.join('\n'); event = [];
    if (data.trim() === '[DONE]') { finished = true; return; }
    let parsed;
    try { parsed = JSON.parse(data); } catch { throw new Error('The server sent malformed streaming data.'); }
    if (parsed.error) throw new Error('The model server reported a generation error. Check its logs.');
    const choice = parsed.choices?.[0];
    const content = choice?.delta?.content;
    if (typeof content === 'string') { output += content; onText(output); }
    if (choice?.finish_reason === 'length') throw new Error('Output limit reached. Increase the output token limit or use a non-reasoning model.');
    if (choice?.finish_reason && choice.finish_reason !== 'stop') throw new Error('The model did not finish a text response.');
    if (choice?.finish_reason === 'stop') finished = true;
  };
  const line = (raw: string) => {
    const l = raw.replace(/\r$/, '');
    if (!l) dispatch();
    else if (l.startsWith('data:')) event.push(l.slice(5).replace(/^ /, ''));
  };
  try {
    while (true) {
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) { line(buffer.slice(0, nl)); buffer = buffer.slice(nl + 1); }
      if (chunk.done || finished) break;
    }
    if (!finished) {
      if (buffer) line(buffer);
      dispatch();
    }
    signal.throwIfAborted();
    if (!finished) throw new Error('The connection ended before the rewrite finished.');
    if (!output.trim()) throw new Error('The model returned no text. Check its output settings.');
    return output;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
