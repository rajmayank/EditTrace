import { test as base, expect, type Page } from '@playwright/test';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

type ModelServer = { url: string; requests: { model: string; messages: { role: string; content: string }[] }[] };
export const test = base.extend<{}, { modelServer: ModelServer }>({
  modelServer: [async ({}, use) => {
    const requests: ModelServer['requests'] = [];
    const server = createServer(async (req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
      if (req.url === '/v1/models') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ data: [{ id: 'edittrace-test-model' }, { id: 'break-locks' }] })); return;
      }
      if (req.url !== '/v1/chat/completions') { res.writeHead(404).end(); return; }
      let body = ''; for await (const data of req) body += data;
      const request = JSON.parse(body); requests.push(request);
      let text = request.messages.at(-1).content
        .replace('client can have room', 'application can have capacity')
        .replace('A concrete trace', 'A specific trace')
        .replace('Please review', 'Please check');
      if (request.model === 'break-locks') text = text.replace(/\[\[ET_[^\]]+\]\]/g, 'CHANGED');
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      const chunks = text.match(/[\s\S]{1,16}/g) ?? [];
      const timer = setInterval(() => {
        if (res.destroyed) { clearInterval(timer); return; }
        const content = chunks.shift();
        if (content !== undefined) res.write('data: ' + JSON.stringify({ choices: [{ delta: { content } }] }) + '\n\n');
        else {
          res.end('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
          clearInterval(timer);
        }
      }, 12);
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    await use({ url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, requests });
    await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); });
  }, { scope: 'worker' }],
});
export { expect };
export async function connect(page: Page, url: string, model?: string) {
  await page.getByRole('button', { name: /Connect a model/ }).click();
  await page.getByRole('textbox', { name: 'Server URL' }).fill(url);
  await page.getByRole('button', { name: 'Test connection' }).click();
  await expect(page.getByRole('dialog').getByText('Connected. 2 models available.')).toBeVisible();
  if (model) await page.getByRole('combobox', { name: 'Default model' }).fill(model);
  await page.getByRole('button', { name: 'Done' }).click();
}
