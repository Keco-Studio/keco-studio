import { NextRequest } from 'next/server';

const markdownToYjsState = jest.fn();
const normalizeYjsState = jest.fn();

jest.mock('@/lib/documents/documentContentCodec', () => ({
  documentContentCodec: { markdownToYjsState, normalizeYjsState },
}));

import { POST } from '@/app/api/mcp/codec/route';

function request(body: string, secret = 'codec-test-secret', headers: HeadersInit = {}) {
  return new NextRequest('https://keco.test/api/mcp/codec', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + secret, 'content-type': 'application/json', ...headers },
    body,
  });
}

function streamedRequest(chunks: Uint8Array[]) {
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index++];
      if (chunk) controller.enqueue(chunk);
      else controller.close();
    },
  });
  return new NextRequest('https://keco.test/api/mcp/codec', {
    method: 'POST',
    headers: { authorization: 'Bearer codec-test-secret', 'content-type': 'application/json' },
    body,
    duplex: 'half',
  });
}

describe('MCP trusted document codec route', () => {
  const originalSecret = process.env.MCP_CODEC_SECRET;

  beforeEach(() => {
    process.env.MCP_CODEC_SECRET = 'codec-test-secret';
    markdownToYjsState.mockReset().mockResolvedValue('encoded-state');
    normalizeYjsState.mockReset().mockResolvedValue({
      yjsStateBase64: 'normalized-state', markdown: '# Normalized',
      normalizationUpdateBase64: 'private', blocks: [{ id: 'private' }],
    });
  });

  afterAll(() => {
    if (originalSecret === undefined) delete process.env.MCP_CODEC_SECRET;
    else process.env.MCP_CODEC_SECRET = originalSecret;
  });

  it('rejects missing or incorrect secrets without invoking the codec', async () => {
    expect((await POST(request('{}', 'wrong'))).status).toBe(401);
    expect(markdownToYjsState).not.toHaveBeenCalled();
  });

  it('encodes and normalizes Markdown while returning only the public pair', async () => {
    const response = await POST(request(JSON.stringify({ mode: 'encode', markdown: '# Title' })));
    expect(response.status).toBe(200);
    expect(markdownToYjsState).toHaveBeenCalledWith('# Title');
    expect(normalizeYjsState).toHaveBeenCalledWith('encoded-state', []);
    expect(await response.json()).toEqual({
      yjsStateBase64: 'normalized-state', markdown: '# Normalized',
    });
  });

  it('accepts exactly 100 KiB of UTF-8 Markdown', async () => {
    const markdown = 'x'.repeat(100 * 1024);
    const response = await POST(request(JSON.stringify({ mode: 'encode', markdown })));
    expect(response.status).toBe(200);
    expect(markdownToYjsState).toHaveBeenCalledWith(markdown);
  });

  it('rejects unknown fields and oversized streamed bodies', async () => {
    expect((await POST(request(JSON.stringify({ mode: 'encode', markdown: 'x', projectId: 'x' })))).status)
      .toBe(400);
    const oversized = JSON.stringify({ mode: 'normalize', snapshot: 'x'.repeat(16 * 1024 * 1024),
      updates: [] });
    expect((await POST(request(oversized))).status).toBe(413);
    const chunk = new TextEncoder().encode('x'.repeat(9 * 1024 * 1024));
    expect((await POST(streamedRequest([chunk, chunk]))).status).toBe(413);
    expect(markdownToYjsState).not.toHaveBeenCalled();
  });

  it('maps codec validation failures to a bounded response', async () => {
    markdownToYjsState.mockRejectedValueOnce(new Error('secret parser details'));
    const response = await POST(request(JSON.stringify({ mode: 'encode', markdown: 'invalid' })));
    expect(response.status).toBe(422);
    expect(JSON.stringify(await response.json())).not.toContain('secret parser details');
  });
});
