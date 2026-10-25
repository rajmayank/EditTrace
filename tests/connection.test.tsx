import { describe, it, expect, vi } from 'vitest';
import { act, render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../src/App';
import { PREFIX } from '../src/core/storage';

const models = () => Response.json({ data: [{ id: 'editor-one' }, { id: 'editor-two' }] });
describe('model connection lifecycle', () => {
  it('shows loading, discovery results, and a selectable model list next to the test button', async () => {
    let resolve!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(r => { resolve = r; })));
    const user = userEvent.setup(); render(<App />);
    await user.click(screen.getByRole('button', { name: /Connect a model/ }));
    await user.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(screen.getByText('Checking server and discovering models…')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Testing connection…' })).toBeDisabled();
    resolve(models());
    expect(await screen.findByText('Connected. 2 models available.')).toBeVisible();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Default model' }), 'editor-two');
    expect(screen.getByRole('combobox', { name: 'Default model' })).toHaveValue('editor-two');
  });
  it('shows network and timeout errors in the dialog', async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockRejectedValueOnce(new DOMException('timed out', 'TimeoutError'));
    vi.stubGlobal('fetch', fetch);
    const user = userEvent.setup(); render(<App />);
    await user.click(screen.getByRole('button', { name: /Connect a model/ }));
    await user.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the server');
    await user.click(screen.getByRole('button', { name: 'Test connection' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Connection timed out'));
  });
  it('rechecks saved configurations after reload instead of showing a stale disconnected badge', async () => {
    localStorage.setItem(PREFIX + 'settings', JSON.stringify({ connection: { url: 'http://localhost:1234/v1', model: 'editor-one', key: '' } }));
    vi.stubGlobal('fetch', vi.fn(async () => models()));
    render(<App />);
    await waitFor(() => expect(document.querySelector('.connection-pill')).toHaveAttribute('data-connection-state', 'connected'));
  });
  it('disconnects, forgets stored keys, and can reconnect', async () => {
    const fetch = vi.fn(async () => models()); vi.stubGlobal('fetch', fetch);
    const user = userEvent.setup(); const { unmount } = render(<App />);
    await user.click(screen.getByRole('button', { name: /Connect a model/ }));
    await user.type(screen.getByLabelText(/API key optional/), 'secret');
    await user.click(screen.getByLabelText('Remember API key on this device'));
    await user.click(screen.getByRole('button', { name: 'Test connection' }));
    await screen.findByText('Connected. 2 models available.');
    await user.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(screen.getByText('Disconnected. Choose a server and test to reconnect.')).toBeVisible();
    const stored = JSON.parse(localStorage.getItem(PREFIX + 'settings')!);
    expect(stored.connection.key).toBe(''); expect(stored.connection.model).toBe('');
    expect(stored.connectionEnabled).toBe(false);
    expect(localStorage.getItem(PREFIX + 'settings')).not.toContain('secret');
    const count = fetch.mock.calls.length; unmount(); render(<App />);
    await new Promise(r => setTimeout(r, 20));
    expect(fetch).toHaveBeenCalledTimes(count);
    await user.click(screen.getByRole('button', { name: /Connect a model/ }));
    await user.click(screen.getByRole('button', { name: 'Test connection' }));
    await screen.findByText('Connected. 2 models available.');
  });
  it('ignores an in-flight model check after disconnecting', async () => {
    let resolve!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(r => { resolve = r; })));
    const user = userEvent.setup(); render(<App />);
    await user.click(screen.getByRole('button', { name: /Connect a model/ }));
    await user.click(screen.getByRole('button', { name: 'Test connection' }));
    await user.click(screen.getByRole('button', { name: 'Disconnect' }));
    await act(async () => { resolve(models()); });
    expect(document.querySelector('.connection-pill')).toHaveAttribute('data-connection-state', 'disconnected');
    expect(screen.queryByText('Connected. 2 models available.')).not.toBeInTheDocument();
  });
  it('provider presets fill documented URLs and clear credentials when switching providers', async () => {
    const user = userEvent.setup(); render(<App />);
    await user.click(screen.getByRole('button', { name: /Connect a model/ }));
    const presets = screen.getByRole('group', { name: 'Provider presets' });
    await user.type(screen.getByLabelText(/API key optional/), 'private-key');
    await user.click(within(presets).getByRole('button', { name: 'Ollama' }));
    expect(screen.getByRole('textbox', { name: 'Server URL' })).toHaveValue('http://localhost:11434/v1');
    expect(screen.getByLabelText(/API key optional/)).toHaveValue('');
    await user.click(within(presets).getByRole('button', { name: 'OpenRouter' }));
    expect(screen.getByRole('textbox', { name: 'Server URL' })).toHaveValue('https://openrouter.ai/api/v1');
    await user.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Add your OpenRouter API key');
  });
});
