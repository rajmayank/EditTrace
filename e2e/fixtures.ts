import { test as base, expect, type Page } from '@playwright/test';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

type ModelServer = { url: string; control: { modelStatus: number; modelDelay: number; tokenDelay: number }; requests: { model: string; messages: { role: string; content: string }[] }[] };
export const test = base.extend<{ resetModel: void }, { modelServer: ModelServer }>({
  resetModel: [async ({ modelServer }, use) => {
    modelServer.control.modelDelay = 0; modelServer.control.modelStatus = 200; modelServer.control.tokenDelay = 0; modelServer.requests.length = 0;
    await use();
  }, { auto: true }],
  modelServer: [async ({}, use) => {
    const requests: ModelServer['requests'] = [];
    const control = { modelStatus: 200, modelDelay: 0, tokenDelay: 0 };
    const server = createServer(async (req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
      if (req.url === '/v1/models') {
        setTimeout(() => {
          if (res.destroyed) return;
          res.setHeader('Content-Type', 'application/json'); res.statusCode = control.modelStatus;
          res.end(JSON.stringify({ data: [{ id: 'edittrace-test-model' }, { id: 'break-locks' }] }));
        }, control.modelDelay).unref();
        return;
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
      const start = () => {
        if (res.destroyed) return;
        const timer = setInterval(() => {
        if (res.destroyed) { clearInterval(timer); return; }
        const content = chunks.shift();
        if (content !== undefined) res.write('data: ' + JSON.stringify({ choices: [{ delta: { content } }] }) + '\n\n');
        else {
          res.end('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
          clearInterval(timer);
        }
        }, 12);
      };
      setTimeout(start, control.tokenDelay).unref();
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    await use({ url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, requests, control });
    await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); });
  }, { scope: 'worker' }],
});
export { expect };
export async function connect(page: Page, url: string, model?: string) {
  await page.getByRole('button', { name: /Connect a model/ }).click();
  await page.getByRole('textbox', { name: 'Server URL' }).fill(url);
  await page.getByRole('button', { name: 'Test connection' }).click();
  await expect(page.getByRole('dialog').getByText('Connected. 2 models available.')).toBeVisible();
  if (model) await page.getByRole('combobox', { name: 'Default model' }).selectOption(model);
  await page.getByRole('button', { name: 'Done' }).click();
}
