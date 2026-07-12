import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { StoryDocument } from '@/lib/story-ir/schema';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn() }));
jest.mock('@/lib/createSupabaseServerClient', () => ({ createSupabaseServerClient: jest.fn() }));
jest.mock('@/lib/services/scriptConversionService', () => ({ resolveStoryForImport: jest.fn() }));
jest.mock('@/lib/services/scriptImportService', () => ({ importStoryDocument: jest.fn() }));

import { resolveStoryForImport } from '@/lib/services/scriptConversionService';
import { importStoryDocument } from '@/lib/services/scriptImportService';
import { POST } from '@/app/api/import-script/route';

const mockedCreateClient = createClient as jest.MockedFunction<typeof createClient>;
const mockedResolve = resolveStoryForImport as jest.MockedFunction<typeof resolveStoryForImport>;
const mockedImport = importStoryDocument as jest.MockedFunction<typeof importStoryDocument>;

const projectId = '22222222-2222-4222-8222-222222222222';
const folderId = '11111111-1111-4111-8111-111111111111';
const ref = { sourceId: 'modal', unitId: 'modal:0', start: 0, end: 5 };
const document: StoryDocument = {
  version: 1,
  entryLabel: 'Start',
  nodes: [{ label: 'Start', type: 'narration', content: 'Story', commands: [], options: [], sourceRefs: [ref] }],
};

function request(): NextRequest {
  const form = new FormData();
  form.append('projectId', projectId);
  form.append('folderId', folderId);
  form.append('libraryName', 'Story');
  form.append('file', new File(['Story'], 'story.txt', { type: 'text/plain' }));
  return new NextRequest('https://example.test/api/import-script', {
    method: 'POST',
    headers: { Authorization: 'Bearer token' },
    body: form,
  });
}

async function records(response: Response): Promise<Array<Record<string, unknown>>> {
  return (await response.text()).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

describe('POST /api/import-script streaming protocol', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedCreateClient.mockReturnValue({
      auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) },
    } as never);
    mockedResolve.mockImplementation(async (_source, options) => {
      options?.onProgress?.({ phase: 'source_segmentation', attempt: 1, message: 'Segmenting' } as never);
      options?.onProgress?.({ phase: 'semantic_audit', attempt: 1, message: 'Auditing' } as never);
      return { document } as never;
    });
    mockedImport.mockResolvedValue({ libraryId: 'library-1', rowCount: 1, fieldCount: 11 });
  });

  it('streams progress followed by one terminal result', async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('application/x-ndjson');
    const streamed = await records(response);
    expect(streamed).toEqual([
      { type: 'progress', progress: { phase: 'source_segmentation', attempt: 1, message: 'Segmenting' } },
      { type: 'progress', progress: { phase: 'semantic_audit', attempt: 1, message: 'Auditing' } },
      { type: 'progress', progress: { phase: 'table_compile', message: 'Compiling script table' } },
      { type: 'progress', progress: { phase: 'database_write', message: 'Writing script library' } },
      { type: 'result', result: { libraryId: 'library-1', rowCount: 1, fieldCount: 11 } },
    ]);
    expect(streamed.some((record) =>
      record.type === 'progress' && 'chunk' in (record.progress as object)
    )).toBe(false);
    expect(mockedImport).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ document }));
  });

  it('streams a terminal error and performs no import when audit fails', async () => {
    mockedResolve.mockRejectedValue(new Error('Semantic audit failed'));

    const response = await POST(request());
    expect(await records(response)).toEqual([{ type: 'error', error: 'Semantic audit failed' }]);
    expect(mockedImport).not.toHaveBeenCalled();
  });

  it('aborts conversion when the response consumer cancels the stream', async () => {
    let conversionSignal: AbortSignal | undefined;
    mockedResolve.mockImplementation(async (_source, options) => {
      conversionSignal = options?.signal;
      await new Promise<void>((_resolve, reject) => {
        conversionSignal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        }, { once: true });
      });
      throw new Error('unreachable');
    });

    const response = await POST(request());
    const reader = response.body!.getReader();
    await reader.cancel();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(conversionSignal?.aborted).toBe(true);
    expect(mockedImport).not.toHaveBeenCalled();
  });
});
