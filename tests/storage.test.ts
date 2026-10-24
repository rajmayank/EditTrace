import { it, expect } from 'vitest';
import { persistSettings, read, PREFIX, type SavedSettings } from '../src/core/storage';
import { DEFAULT_LOCKS } from '../src/core/types';
it('stores settings without an API key until explicitly opted in', () => {
  const settings: SavedSettings = { connection: { url: 'http://localhost:1234/v1', key: 'secret', model: 'test', temperature: .3, maxTokens: 4096 }, rememberKey: false, saveDrafts: false, theme: 'light', preset: 'article', prompt: 'Edit.', locks: DEFAULT_LOCKS };
  persistSettings(settings);
  expect(localStorage.getItem(PREFIX + 'settings')).not.toContain('secret');
  persistSettings({ ...settings, rememberKey: true });
  expect(read<SavedSettings>('settings', settings).connection.key).toBe('secret');
  persistSettings(settings);
  expect(localStorage.getItem(PREFIX + 'settings')).not.toContain('secret');
});
it('recovers from invalid JSON', () => {
  localStorage.setItem(PREFIX + 'draft', '{invalid');
  expect(read('draft', null)).toBeNull();
});
