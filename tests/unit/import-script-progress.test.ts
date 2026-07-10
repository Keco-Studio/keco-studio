import { describe, expect, it, jest } from '@jest/globals';
import { consumeImportStream } from '@/lib/import-script-stream';

const encoder = new TextEncoder();

function streamedResponse(parts: string[]): Response {
  return new Response(new ReadableStream({
    start(controller) {
      parts.forEach((part) => controller.enqueue(encoder.encode(part)));
      controller.close();
    },
  }), { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } });
}

describe('Import Script NDJSON decoder', () => {
  it('decodes records split across arbitrary byte chunks', async () => {
    const onProgress = jest.fn();
    const response = streamedResponse([
      '{"type":"progress","progress":{"phase":"conver',
      'sion","message":"Converting"}}\n{"type":"res',
      'ult","result":{"libraryId":"lib-1","rowCount":2,"fieldCount":11}}\n',
    ]);

    await expect(consumeImportStream(response, onProgress)).resolves.toEqual({
      libraryId: 'lib-1',
      rowCount: 2,
      fieldCount: 11,
    });
    expect(onProgress).toHaveBeenCalledWith({ phase: 'conversion', message: 'Converting' });
  });

  it('throws a streamed terminal error', async () => {
    const response = streamedResponse(['{"type":"error","error":"Audit failed"}\n']);
    await expect(consumeImportStream(response, jest.fn())).rejects.toThrow('Audit failed');
  });

  it('rejects malformed stream records', async () => {
    const response = streamedResponse(['{"type":"progress"}\nnot-json\n']);
    await expect(consumeImportStream(response, jest.fn())).rejects.toThrow(/malformed JSON/i);
  });

  it('rejects a stream without a terminal result', async () => {
    const response = streamedResponse(['{"type":"progress","progress":{"phase":"merge","message":"Merging"}}\n']);
    await expect(consumeImportStream(response, jest.fn())).rejects.toThrow(/ended without a result/i);
  });
});
