import { expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Preview } from '../src/Preview';

it('keeps nested HTML disclosures and reference links intact when adding scroll anchors', () => {
  render(<Preview value={'# Context\n\n<details open>\n<summary>More context</summary>\n\nRead the [guide][ref].\n\n</details>\n\n[ref]: https://example.com\n'} />);
  const preview = screen.getByLabelText('Markdown preview');
  expect(preview.querySelector('details p a')).toHaveAttribute('href', 'https://example.com');
  expect(preview.querySelector('details summary')).toHaveTextContent('More context');
  expect(preview.querySelector('h1')).toHaveTextContent('Context');
});

it('still blocks executable markup and remote images across annotated blocks', () => {
  render(<Preview value={'# Context\n\n<img src="https://tracker.invalid/x" onerror="alert(1)">\n\n<script>alert(1)</script>\n\n[bad](javascript:alert(1))'} />);
  const preview = screen.getByLabelText('Markdown preview');
  expect(preview.querySelector('img, script, [onerror], a[href^="javascript:"]')).toBeNull();
  expect(preview.querySelector('h1')).toHaveTextContent('Context');
});
