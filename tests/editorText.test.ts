import { expect, it } from 'vitest';
import { editorText } from '../src/core/editorText';

it('maps editor positions to original CRLF text without changing protected bytes', () => {
  const raw = 'A\r\nB\r\nC', index = editorText(raw);
  expect(index.normalized).toBe('A\nB\nC');
  for (const position of [0, 1, 3, 4, 6, 7]) expect(index.toRaw(index.toDoc(position))).toBe(position);
  expect(index.toDoc(6)).toBe(4); expect(index.toRaw(4)).toBe(6);
  expect(index.lineEnding).toBe('\r\n');
});

it('handles LF, lone CR, and mixed files while preserving original offsets', () => {
  expect(editorText('A\nB').toRaw(2)).toBe(2);
  expect(editorText('A\rB').normalized).toBe('A\nB');
  const index = editorText('A\r\nB\nC\rD');
  expect(index.normalized).toBe('A\nB\nC\nD');
  expect(index.toDoc(8)).toBe(7);
  expect(index.toRaw(7)).toBe(8);
});
