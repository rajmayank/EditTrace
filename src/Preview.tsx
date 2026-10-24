import { useMemo } from 'react';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
export function Preview({ value }: { value: string }) {
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(value, { async: false, gfm: true }), {
    FORBID_TAGS: ['img', 'iframe', 'form', 'input', 'video', 'audio', 'svg', 'math', 'style'],
    FORBID_ATTR: ['style', 'id', 'name', 'target'],
  }), [value]);
  return <div className="markdown-preview" aria-label="Markdown preview" dangerouslySetInnerHTML={{ __html: html }} />;
}
