import { McpDomainError } from './errors.ts';

export type NormalizedDocument = { yjsStateBase64: string; markdown: string };

async function codecRequest(body: Record<string, unknown>): Promise<NormalizedDocument> {
  const origin = Deno.env.get('KECO_PUBLIC_URL');
  const secret = Deno.env.get('MCP_CODEC_SECRET');
  if (!origin || !secret) throw new Error('MCP document codec is not configured.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(new URL('/api/mcp/codec', origin), { method: 'POST',
      signal: controller.signal, headers: { authorization: 'Bearer ' + secret,
        'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!response.ok) throw response.status === 422
      ? new McpDomainError('FIELD_VALIDATION_FAILED', 'Document Markdown is invalid.')
      : new McpDomainError('INTERNAL_ERROR', 'Document codec is unavailable.');
    const value = await response.json();
    if (typeof value?.yjsStateBase64 !== 'string' || typeof value?.markdown !== 'string')
      throw new Error('Invalid codec response.');
    return value;
  } finally { clearTimeout(timeout); }
}

export const encodeDocumentMarkdown = (markdown: string) =>
  codecRequest({ mode: 'encode', markdown });
export const normalizeDocumentState = (snapshot: string | null, updates: string[]) =>
  codecRequest({ mode: 'normalize', snapshot, updates });
