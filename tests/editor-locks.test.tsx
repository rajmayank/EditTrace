import { expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { EditorView } from '@codemirror/view';
import { Editor } from '../src/Editor';

it('blocks replacements, deletion, and insertion inside protected output even before React rerenders', async () => {
  const change = vi.fn(), blocked = vi.fn();
  render(<Editor label="Result" value="edit FACT end" locks={[{ from: 5, to: 9, kind: 'Fact' }]} lockEdits onChange={change} onBlockedEdit={blocked} />);
  const view = EditorView.findFromDOM(screen.getByRole('textbox', { name: 'Result' }))!;
  view.dispatch({ changes: { from: 0, insert: 'New ' } });
  expect(view.state.doc.toString()).toBe('New edit FACT end');
  for (const edit of [{ from: 9, to: 13, insert: 'BAD' }, { from: 10, insert: 'X' }, { from: 12, to: 13 }]) view.dispatch({ changes: edit });
  expect(view.state.doc.toString()).toBe('New edit FACT end');
  expect(change).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(blocked).toHaveBeenCalledTimes(3));
});

it('rejects the whole paste transaction when one replacement crosses a protected span', () => {
  const change = vi.fn();
  render(<Editor label="Result" value="edit FACT end" locks={[{ from: 5, to: 9, kind: 'Fact' }]} lockEdits onChange={change} />);
  const view = EditorView.findFromDOM(screen.getByRole('textbox', { name: 'Result' }))!;
  view.dispatch({ changes: [{ from: 0, to: 4, insert: 'new' }, { from: 5, to: 9, insert: 'changed' }] });
  expect(view.state.doc.toString()).toBe('edit FACT end');
  expect(change).not.toHaveBeenCalled();
});

it('still permits intentional source changes and drops a manually edited source fact', () => {
  const change = vi.fn();
  const lock = { from: 5, to: 9, kind: 'Fact' };
  render(<Editor label="Source" value="edit FACT end" locks={[lock]} onChange={change} />);
  const view = EditorView.findFromDOM(screen.getByRole('textbox', { name: 'Source' }))!;
  view.dispatch({ changes: { from: 5, to: 9, insert: 'a new fact' } });
  expect(change.mock.calls[0][0]).toBe('edit a new fact end');
  expect(change.mock.calls[0][1]([lock])).toEqual([]);
});

it('preserves CRLF bytes and raw protection coordinates while the editor uses normalized positions', () => {
  const text = 'Intro\r\n\r\n```txt\r\nFACT\r\n```\r\n';
  const lock = { from: text.indexOf('```'), to: text.length, kind: 'Code block' };
  const change = vi.fn(), select = vi.fn();
  render(<Editor label="Result" value={text} locks={[lock]} lockEdits onChange={change} onSelection={select} />);
  const view = EditorView.findFromDOM(screen.getByRole('textbox', { name: 'Result' }))!;
  view.dispatch({ selection: { anchor: view.state.doc.line(4).from, head: view.state.doc.line(4).to } });
  expect(select).toHaveBeenLastCalledWith({ from: text.indexOf('FACT'), to: text.indexOf('FACT') + 4 });
  view.dispatch({ changes: { from: 0, insert: 'New ' } });
  const [value, map] = change.mock.calls[0];
  expect(value).toBe('New ' + text);
  expect(map([lock])).toEqual([{ ...lock, from: lock.from + 4, to: lock.to + 4 }]);
  const fact = view.state.doc.toString().indexOf('FACT');
  view.dispatch({ changes: { from: fact, to: fact + 4, insert: 'BAD' } });
  expect(change).toHaveBeenCalledTimes(1);
});
