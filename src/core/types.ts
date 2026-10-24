export type Format = 'markdown' | 'email' | 'text';
export type Span = { from: number; to: number };
export type Lock = Span & { kind: string };
export type LockOptions = { structure: boolean; inline: boolean; numbers: boolean; signature: boolean };
export type Connection = { url: string; model: string; key: string; temperature: number; maxTokens: number };
export type Issue = Span & { message: string };
export const DEFAULT_LOCKS: LockOptions = { structure: true, inline: true, numbers: true, signature: true };
