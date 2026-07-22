import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { documentContentCodec } from '@/lib/documents/documentContentCodec';

export const runtime = 'nodejs';
const MAX_CODEC_REQUEST_BYTES = 16 * 1024 * 1024;
const MAX_CODEC_RESPONSE_BYTES = 16 * 1024 * 1024;
const MAX_MARKDOWN_BYTES = 100 * 1024;
const MAX_UPDATES = 2_000;

function authorized(request: NextRequest): boolean {
  const expected = process.env.MCP_CODEC_SECRET;
  const supplied = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!expected || !supplied) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function readBoundedText(request: NextRequest): Promise<string | null> {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      if (total + value.byteLength >= MAX_CODEC_REQUEST_BYTES) {
        await reader.cancel();
        return null;
      }
      total += value.byteLength;
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

function normalizedResponse(normalized: { yjsStateBase64: string; markdown: string }): NextResponse {
  const body = JSON.stringify({ yjsStateBase64: normalized.yjsStateBase64,
    markdown: normalized.markdown });
  if (Buffer.byteLength(body, 'utf8') >= MAX_CODEC_RESPONSE_BYTES) {
    return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
  }
  return new NextResponse(body, { status: 200,
    headers: { 'content-type': 'application/json' } });
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared >= MAX_CODEC_REQUEST_BYTES) {
    return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
  }
  try {
    const text = await readBoundedText(request);
    if (text === null) {
      return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
    }
    const input = JSON.parse(text) as { mode?: string; markdown?: string;
      snapshot?: string | null; updates?: string[] };
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return NextResponse.json({ error: 'Invalid codec request' }, { status: 400 });
    }
    const keys = Object.keys(input);
    if (input.mode === 'encode' && keys.length === 2 && keys.includes('markdown') &&
        typeof input.markdown === 'string' &&
        Buffer.byteLength(input.markdown, 'utf8') <= MAX_MARKDOWN_BYTES) {
      const encoded = await documentContentCodec.markdownToYjsState(input.markdown);
      const normalized = await documentContentCodec.normalizeYjsState(encoded, []);
      return normalizedResponse(normalized);
    }
    if (input.mode === 'normalize' && keys.length === 3 && keys.includes('snapshot') &&
      keys.includes('updates') && (input.snapshot === null || typeof input.snapshot === 'string') &&
      Array.isArray(input.updates) && input.updates.length <= MAX_UPDATES &&
      input.updates.every(value => typeof value === 'string')) {
      const normalized = await documentContentCodec.normalizeYjsState(input.snapshot, input.updates);
      return normalizedResponse(normalized);
    }
    return NextResponse.json({ error: 'Invalid codec request' }, { status: 400 });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: 'Invalid codec request' }, { status: 400 });
    }
    return NextResponse.json({ error: 'Document content is invalid' }, { status: 422 });
  }
}
