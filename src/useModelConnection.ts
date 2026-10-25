import { useEffect, useRef, useState } from 'react';
import { baseURL, connectionError, listModels } from './core/api';
import { providerFor } from './core/providers';
import type { Connection } from './core/types';

type Phase = 'idle' | 'checking' | 'connected' | 'error' | 'disconnected';
type State = { phase: Phase; message: string; identity: string; models: string[] };
export function useModelConnection(connection: Connection, enabled: boolean, onModels: (models: string[]) => void) {
  const identity = connection.url + '\n' + connection.key;
  const current = useRef({ connection, enabled, identity, onModels });
  current.current = { connection, enabled, identity, onModels };
  const controller = useRef<AbortController | null>(null), request = useRef(0);
  const [state, setState] = useState<State>({ phase: 'idle', message: '', identity, models: [] });
  function reset() {
    request.current++; controller.current?.abort();
    setState({ phase: current.current.enabled ? 'idle' : 'disconnected', message: current.current.enabled ? '' : 'Disconnected. Choose a server and test to reconnect.', identity: current.current.identity, models: [] });
  }
  async function test() {
    const c = { ...current.current.connection }, stamp = current.current.identity;
    controller.current?.abort();
    const active = new AbortController(); controller.current = active;
    const id = ++request.current;
    setState(s => ({ ...s, phase: 'checking', message: 'Checking server and discovering models…', identity: stamp }));
    try {
      baseURL(c.url);
      if (providerFor(c.url).keyRequired && !c.key.trim()) throw new Error('Add your OpenRouter API key before connecting.');
      const models = await listModels(c, active.signal);
      if (active.signal.aborted || id !== request.current || current.current.identity !== stamp) return;
      setState({ phase: 'connected', message: `Connected. ${models.length} model${models.length === 1 ? '' : 's'} available.`, identity: stamp, models });
      current.current.onModels(models);
    } catch (error) {
      if (!active.signal.aborted && id === request.current && current.current.identity === stamp) {
        setState({ phase: 'error', message: connectionError(error), identity: stamp, models: [] });
      }
    }
  }
  useEffect(() => { reset(); }, [identity]);
  useEffect(() => { if (!enabled) reset(); }, [enabled]);
  // Restore an actual connection check, never a persisted claim of connectivity.
  useEffect(() => {
    if (current.current.enabled && current.current.connection.model) void test();
    return () => { request.current++; controller.current?.abort(); };
  }, []);
  function streaming() {
    setState(s => s.phase === 'connected' && s.identity === current.current.identity ? s : { ...s, identity: current.current.identity, phase: 'connected', message: 'Connected. Receiving edits from your model.' });
  }
  function failed(error: unknown) {
    setState(s => ({ ...s, identity: current.current.identity, phase: 'error', message: connectionError(error) }));
  }
  const visible = state.identity === identity && enabled ? state : { phase: enabled ? 'idle' as const : 'disconnected' as const, message: enabled ? '' : 'Disconnected. Choose a server and test to reconnect.', identity, models: [] };
  return { ...visible, testing: visible.phase === 'checking', connected: visible.phase === 'connected', test, reset, streaming, failed };
}
