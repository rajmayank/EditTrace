import { describe, it, expect } from 'vitest';
import { autoLocks, mergeLocks, protect, restore, streamText } from '../src/core/protection';
import { DEFAULT_LOCKS } from '../src/core/types';
import { planDocument } from '../src/core/plan';

describe('document protection', () => {
  const doc = '---\ntitle: Post\n---\n\n# Heading\n\nA **bold** value of 42 and `ss -s`. See [guide](https://example.com/a_(b)).\n\n- First point\n- Second point\n\n```sh\necho "keep"\n\necho "also keep"\n```\n\nName | Value\n--- | ---\nPort | 443\n';
  it('keeps recognized blocks out of generation and round-trips every character', () => {
    const plan = planDocument(doc, autoLocks(doc, 'markdown', DEFAULT_LOCKS));
    expect(plan.map(u => u.source).join('')).toBe(doc);
    const sent = plan.filter(u => u.editable).map(u => protect(u.source, u.locks));
    for (const forbidden of ['echo', 'Port |', 'title: Post']) expect(sent.map(p => p.text).join('')).not.toContain(forbidden);
    for (const p of sent) expect(restore(p.text, p)).not.toBeNull();
  });
  it('protects list markers, inline code, complete links, and numbers', () => {
    const locks = autoLocks(doc, 'markdown', DEFAULT_LOCKS);
    const covered = (text: string) => { const start = doc.indexOf(text); return locks.some(l => l.from <= start && l.to >= start + text.length); };
    for (const text of ['**', '42', '`ss -s`', '[guide](https://example.com/a_(b))', '- ']) expect(covered(text), text).toBe(true);
  });
  it('locks heading notation and line breaks without locking the wording', () => {
    const text = '# A closer look at connection limits\r\n\r\n## Another heading ##\n\nA setext title\n===\n';
    const locks = autoLocks(text, 'markdown', DEFAULT_LOCKS);
    const masked = protect(text, locks);
    expect(masked.text).toContain('A closer look at connection limits');
    expect(masked.text).toContain('Another heading');
    expect(masked.text).toContain('A setext title');
    expect(masked.text).not.toContain('#');
    expect(masked.text).not.toContain('===');
    expect(masked.text).not.toMatch(/[\r\n]/);
    expect(restore(masked.text, masked)).toBe(text);
    const manual = protect(text, autoLocks(text, 'markdown', DEFAULT_LOCKS, [{ from: 2, to: 35 }]));
    expect(manual.text).not.toContain('A closer look at connection limits');
  });
  it('protects email signatures through the end of the message', () => {
    const email = 'Hi Alex,\n\nPlease review the deployment plan.\n\nBest regards,\nMayank\nStaff Engineer\n';
    const p = protect(email, autoLocks(email, 'email', DEFAULT_LOCKS));
    expect(p.text).not.toContain('Mayank');
    expect(p.tokens.some(t => t.original.includes('Best regards,\nMayank\nStaff Engineer'))).toBe(true);
    expect(restore(p.text, p)).toBe(email);
  });
  it('recognizes explicit email signature separators and quoted threads', () => {
    const text = 'Message body.\n\n-- \nName\n\nOn Tuesday, Alex wrote:\nOld text';
    expect(autoLocks(text, 'email', DEFAULT_LOCKS).some(r => r.kind.includes('Signature') && r.to === text.length)).toBe(true);
  });
  it('merges manual locks with automatic ranges without losing content', () => {
    const text = 'Keep 12 days exactly.';
    const p = protect(text, autoLocks(text, 'text', DEFAULT_LOCKS, [{ from: 0, to: 12 }]));
    expect(p.tokens[0].original).toBe('Keep 12 days');
    expect(restore(p.text, p)).toBe(text);
    expect(mergeLocks([{ from: 0, to: 5, kind: 'A' }, { from: 2, to: 9, kind: 'B' }])).toHaveLength(1);
  });
  it('rejects missing, duplicate, reordered, and unknown markers', () => {
    const p = protect('One fact and two facts', [{ from: 4, to: 8, kind: 'Manual' }, { from: 17, to: 22, kind: 'Manual' }]);
    const [a, b] = p.tokens.map(t => t.marker);
    for (const output of [p.text.replace(a, ''), p.text + a, b + a, p.text + `[[ET_${p.namespace}_99]]`]) expect(restore(output, p)).toBeNull();
  });
  it('hides partial stream markers and renders complete ones literally', () => {
    const p = protect('Hello <name>', [{ from: 6, to: 12, kind: 'Manual' }], 'test');
    expect(streamText('Hello [[ET_tes', p)).toBe('Hello ');
    expect(streamText('Hello [[', p)).toBe('Hello ');
    expect(streamText(p.text, p)).toBe('Hello <name>');
  });
  it('preserves CRLF, blank lines, and source during long paragraph splitting', () => {
    const text = ('Some useful prose about networking. '.repeat(200)) + '\r\n \r\nLast paragraph.\r\n';
    const plan = planDocument(text, autoLocks(text, 'markdown', DEFAULT_LOCKS));
    expect(plan.map(u => u.source).join('')).toBe(text);
    expect(plan.filter(u => u.editable).length).toBeGreaterThan(1);
    expect(plan.find(u => u.source.includes('\r\n \r\n'))?.editable).toBe(false);
  });
  it('does not cut through a manual lock at a chunk boundary', () => {
    const text = 'word '.repeat(600);
    const plan = planDocument(text, [{ from: 2100, to: 2400, kind: 'Manual' }]);
    expect(plan.some(u => u.to > 2100 && u.to < 2400)).toBe(false);
    expect(plan.map(u => u.source).join('')).toBe(text);
  });
  it('protects unclosed code fences to end of document', () => {
    const text = '```\nNever edit\n\nthis either';
    expect(planDocument(text, autoLocks(text, 'markdown', DEFAULT_LOCKS)).some(u => u.editable)).toBe(false);
  });
});
