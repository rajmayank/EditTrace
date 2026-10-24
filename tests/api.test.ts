import { describe, it, expect, vi } from 'vitest';
import { baseURL, complete, listModels } from '../src/core/api';
import type { Connection } from '../src/core/types';

const c: Connection = { url: 'http://localhost:1234/v1', model: 'local-model', key: '', temperature: .3, maxTokens: 4096 };
export function sse(content: string, finish: string = 'stop') {
  return 'data: ' + JSON.stringify({ choices: [{ delta: { content } }] }) + '\r\n\r\ndata: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: finish }] }) + '\r\n\r\ndata: [DONE]\r\n\r\n';
}
export function streamResponse(text: string, size = 3) {
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({ start(controller) {
    for (let n = 0; n < bytes.length; n += size) controller.enqueue(bytes.slice(n, n + size));
    controller.close();
  } }), { headers: { 'Content-Type': 'text/event-stream' } });
}
describe('model API', () => {
  it('normalizes server addresses and rejects unsupported schemes and credentials', () => {
    expect(baseURL('http://localhost:1234/')).toBe(c.url);
    expect(baseURL(c.url + '/chat/completions')).toBe(c.url);
    expect(baseURL('https://models.example/api/v1/models')).toBe('https://models.example/api/v1');
    for (const u of ['file:///etc/passwd', 'javascript:alert(1)', 'https://user:password@example.com']) expect(() => baseURL(u)).toThrow();
  });
  it('discovers models using the chosen API key', async () => {
    const fetch = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => Response.json({ data: [{ id: 'one' }, { id: 'two' }] })); vi.stubGlobal('fetch', fetch);
    expect(await listModels({ ...c, key: 'secret' })).toEqual(['one', 'two']);
    expect(fetch.mock.calls[0][0]).toBe(c.url + '/models');
  });
  it('parses arbitrarily split UTF-8 and CRLF events, sending system instructions', async () => {
    let body: Record<string, unknown> = {};
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => { body = JSON.parse(options.body); return streamResponse(sse('Café 中文.')); }));
    const onText = vi.fn();
    expect(await complete(c, 'Keep the facts.', 'Original text', new AbortController().signal, onText)).toBe('Café 中文.');
    expect(body.messages).toEqual([{ role: 'system', content: 'Keep the facts.' }, { role: 'user', content: 'Original text' }]);
    expect(onText).toHaveBeenCalledWith('Café 中文.');
  });
  it('rejects a dropped stream, truncated generation, malformed data, and tool results', async () => {
    for (const text of [
      'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n',
      sse('partial', 'length'), 'data: invalid\n\n', sse('tools', 'tool_calls'),
    ]) {
      vi.stubGlobal('fetch', vi.fn(async () => streamResponse(text)));
      await expect(complete(c, '', 'input', new AbortController().signal, () => {})).rejects.toThrow();
    }
  });
  it('handles a final event without a trailing newline', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => streamResponse(sse('Complete.').trimEnd())));
    expect(await complete(c, '', '', new AbortController().signal, () => {})).toBe('Complete.');
  });
  it('finishes without waiting for a server to close a completed stream', async () => {
    const cancel = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode(sse('Complete.'))); }, cancel,
    }))));
    expect(await complete(c, '', '', new AbortController().signal, () => {})).toBe('Complete.');
    expect(cancel).toHaveBeenCalled();
  });
  it('does not expose server response bodies in authentication errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('sensitive draft or key', { status: 401 })));
    await expect(complete(c, '', '', new AbortController().signal, () => {})).rejects.toThrow('Authentication failed');
  });
  it('rejects empty responses even when marked done', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => streamResponse('data: [DONE]\n\n')));
    await expect(complete(c, '', '', new AbortController().signal, () => {})).rejects.toThrow('no text');
  });
});
