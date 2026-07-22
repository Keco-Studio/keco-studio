import { McpDomainError } from './errors.ts';

export type NormalizedDocument = { yjsStateBase64: string; markdown: string };

const MAX_PRIVATE_CODEC_BYTES = 16 * 1024 * 1024;
const encoder = new TextEncoder();

async function codecRequest(body: Record<string, unknown>): Promise<NormalizedDocument> {
  const origin = Deno.env.get('KECO_PUBLIC_URL');
  const secret = Deno.env.get('MCP_CODEC_SECRET');
  if (!origin || !secret) throw new Error('MCP document codec is not configured.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const serialized = JSON.stringify(body);
    if (encoder.encode(serialized).byteLength >= MAX_PRIVATE_CODEC_BYTES) {
      throw new McpDomainError('PAYLOAD_TOO_LARGE',
        'The document collaboration tail requires compaction before it can be processed.');
    }
    const response = await fetch(new URL('/api/mcp/codec', origin), { method: 'POST',
      signal: controller.signal, headers: { authorization: 'Bearer ' + secret,
        'content-type': 'application/json' }, body: serialized });
    if (!response.ok) throw response.status === 413
      ? new McpDomainError('PAYLOAD_TOO_LARGE',
        'The document collaboration tail requires compaction before it can be processed.')
      : response.status === 422
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
