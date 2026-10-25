import type { Format } from './types';

const DRAFT_TITLES = [
  'Draft in motion',
  'First spark draft',
  'Fresh ink draft',
  'Taking shape draft',
  'Still brewing draft',
  'Rough cut draft',
  'Early thoughts draft',
  'Next chapter draft',
] as const;

export function draftTitle(savedTitle?: string): string {
  if (savedTitle?.trim() && savedTitle !== 'Untitled draft') return savedTitle;
  return DRAFT_TITLES[Math.floor(Math.random() * DRAFT_TITLES.length)];
}

export const PRESETS: { id: string; name: string; format: Format; prompt: string }[] = [
  { id: 'article', name: 'Technical article', format: 'markdown', prompt: 'Lightly copyedit this long-form technical article. Preserve its reasoning, depth, first-person perspective, examples, and precise terminology. Keep definite claims definite and qualified claims qualified. Improve awkward or repetitive phrasing. Leave effective sentences unchanged. Do not summarize, add facts, add slang, or make the tone promotional.' },
  { id: 'markdown', name: 'Markdown edit', format: 'markdown', prompt: 'Edit this Markdown document for clarity and flow. Preserve heading levels, paragraph order, list structure, links, code, emphasis, and factual content. Heading wording may be improved. Improve prose without condensing the document or changing its purpose. Leave useful detail and effective sentences in place.' },
  { id: 'email', name: 'Email polish', format: 'email', prompt: 'Edit this email so it is clear, direct, and considerate. Keep the sender’s intent, requests, commitments, names, dates, and level of formality. Preserve the greeting and signature. Remove unnecessary repetition and ceremonial phrasing. Do not add promises or invent context.' },
  { id: 'light', name: 'Light copyedit', format: 'text', prompt: 'Make minimal edits for grammar, clarity, and readability. Preserve the author’s voice, paragraph structure, factual claims, and length. Keep sentences that already work. Do not summarize, invent details, or introduce a new tone.' },
];
export const SAMPLE = `# A closer look at connection limits\n\nA client can have room for more sockets while its gateway cannot allocate another source port. Those are two different limits. The fix depends on where allocation failed.\n\n## Follow the connection\n\nStart with the source address and port the operating system chooses. Then check the translated source the destination sees. A concrete trace is more useful than treating “available ports” as one shared bucket.\n\n- Keep the destination and protocol consistent.\n- Check the timeout before changing the connection pool.\n\nRun \`ss -s\` to inspect the local socket summary. The [networking guide](https://example.com/networking) explains the next step.\n\n\`\`\`sh\nss -s\n\`\`\`\n`;
