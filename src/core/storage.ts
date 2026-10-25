import type { Connection, Format, Span, LockOptions, Issue } from './types';
export type Draft = { source: string; output: string; manual: Span[]; format: Format; name: string; issues?: Issue[] };
export type SavedSettings = { connection: Connection; connectionEnabled?: boolean; provider?: string; rememberKey: boolean; saveDrafts: boolean; theme: string; preset: string; prompt: string; locks: LockOptions };
export const PREFIX = 'edittrace.v1.';
export function read<T>(key: string, fallback: T): T {
  try { const raw = localStorage.getItem(PREFIX + key); return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; }
}
export function write(key: string, value: unknown) {
  try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); return true; } catch { return false; }
}
export function remove(key: string) { try { localStorage.removeItem(PREFIX + key); } catch { /* Storage can be disabled. */ } }
export function persistSettings(settings: SavedSettings) {
  return write('settings', { ...settings, connection: { ...settings.connection, key: settings.rememberKey ? settings.connection.key : '' } });
}
