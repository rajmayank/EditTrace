import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../src/App';
import { EditorView } from '@codemirror/view';
import { PREFIX } from '../src/core/storage';

const stream = (text: string) => new Response(new ReadableStream({ start(controller) {
  controller.enqueue(new TextEncoder().encode('data: ' + JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n')); controller.close();
} }));
describe('editing workspace', () => {
  it('connects, edits the sample, protects Markdown, and shows both sides of the diff', async () => {
    const user = userEvent.setup();
    const fetch = vi.fn(async (url: string, options?: RequestInit) => {
      if (url.endsWith('/models')) return Response.json({ data: [{ id: 'test-editor' }] });
      const request = JSON.parse(options?.body as string);
      return stream(request.messages[1].content.replace('concrete', 'specific').replace('client', 'application'));
    });
    vi.stubGlobal('fetch', fetch);
    render(<App />);
    await user.click(screen.getByRole('button', { name: /Connect a model/ }));
    await user.click(screen.getByRole('button', { name: /Test connection/ }));
    await within(screen.getByRole('dialog')).findByText('Connected. 1 model available.');
    await user.click(screen.getByRole('button', { name: 'Done' }));
    await user.click(screen.getByRole('button', { name: /Try a sample/ }));
    await user.click(screen.getByRole('button', { name: /Edit draft/ }));
    await screen.findByText('Edit complete. Every lock checked.');
    expect(document.querySelector('.removed')).not.toBeNull();
    expect(document.querySelector('.added')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Export' })).toBeEnabled();
    expect(localStorage.getItem(PREFIX + 'draft')).toBeNull();
    const modelRequests = fetch.mock.calls.filter(([url]) => url.endsWith('/chat/completions'));
    expect(modelRequests.length).toBeGreaterThan(0);
    expect(modelRequests.some(([, options]) => (options?.body as string).includes('ss -s'))).toBe(false);
  });
  it('locks a real editor selection and tracks edits before it', async () => {
    const user = userEvent.setup(); render(<App />);
    await user.click(screen.getByRole('button', { name: /Try a sample/ }));
    const editor = screen.getByRole('textbox', { name: 'Original draft' });
    const view = EditorView.findFromDOM(editor)!;
    const text = view.state.doc.toString(); const from = text.indexOf('client');
    fireEvent.mouseDown(editor);
    view.dispatch({ selection: { anchor: from, head: from + 6 } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Lock selection' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Lock selection' }));
    await user.click(screen.getByRole('button', { name: /protected/ }));
    expect(within(screen.getByRole('dialog')).getByText('client')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Done' }));
    view.dispatch({ changes: { from: 0, insert: 'Intro\n\n' } });
    await user.click(screen.getByRole('button', { name: /protected/ }));
    expect(within(screen.getByRole('dialog')).getByText('client')).toBeVisible();
  });
  it('switches presets and offers automatic signature protection', async () => {
    const user = userEvent.setup(); render(<App />);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Editing preset' }), 'email');
    await user.click(screen.getByRole('button', { name: 'Instructions' }));
    expect((screen.getByRole('textbox', { name: 'System prompt' }) as HTMLTextAreaElement).value).toContain('email');
  });
  it('sanitizes preview HTML and blocks remote images', async () => {
    const user = userEvent.setup(); render(<App />);
    const view = EditorView.findFromDOM(screen.getByRole('textbox', { name: 'Original draft' }))!;
    view.dispatch({ changes: { from: 0, insert: '# Title\n\n<img src="https://tracker.invalid/x" onerror="alert(1)"><script>alert(1)</script>\n\n[bad](javascript:alert(1))' } });
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    const preview = screen.getByLabelText('Markdown preview');
    expect(preview.querySelector('img,script,[onerror],a[href^="javascript:"]')).toBeNull();
    expect(preview).toHaveTextContent('Title');
  });
});
