import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { NextRequest } from 'next/server';

jest.mock('server-only', () => ({}));
import { createClient } from '@supabase/supabase-js';
import type { StoryDocument } from '@/lib/story-ir/schema';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn() }));
jest.mock('@/lib/createSupabaseServerClient', () => ({ createSupabaseServerClient: jest.fn() }));
jest.mock('@/lib/services/scriptConversionService', () => ({ resolveStoryForImport: jest.fn() }));
jest.mock('@/lib/services/scriptImportService', () => ({ importStoryDocument: jest.fn() }));
jest.mock('@/lib/server/documentExportSourceService', () => ({ getDocumentExportSource: jest.fn() }));

import { resolveStoryForImport } from '@/lib/services/scriptConversionService';
import { importStoryDocument } from '@/lib/services/scriptImportService';
import { getDocumentExportSource } from '@/lib/server/documentExportSourceService';
import { POST } from '@/app/api/import-script/route';
import { createDocumentExportSnapshotToken } from '@/lib/server/documentExportSnapshotSigning';

const mockedCreateClient = createClient as jest.MockedFunction<typeof createClient>;
const mockedResolve = resolveStoryForImport as jest.MockedFunction<typeof resolveStoryForImport>;
const mockedImport = importStoryDocument as jest.MockedFunction<typeof importStoryDocument>;
const mockedGetDocumentExportSource = getDocumentExportSource as jest.MockedFunction<typeof getDocumentExportSource>;

const projectId = '22222222-2222-4222-8222-222222222222';
const folderId = '11111111-1111-4111-8111-111111111111';
const documentId = '55555555-5555-4555-8555-555555555555';
const ref = { sourceId: 'modal', unitId: 'modal:0', start: 0, end: 5 };
const document: StoryDocument = {
  version: 1,
  entryLabel: 'Start',
  nodes: [{ label: 'Start', type: 'narration', content: 'Story', commands: [], options: [], sourceRefs: [ref] }],
};

function request(options: {
  folderId?: string | null;
  sourceDocumentId?: string;
  projectId?: string;
  fileContent?: string;
  snapshotToken?: string;
} = {}): NextRequest {
  const form = new FormData();
  form.append('projectId', options.projectId ?? projectId);
  if (options.folderId !== null) form.append('folderId', options.folderId ?? folderId);
  if (options.sourceDocumentId) {
    form.append('sourceDocumentId', options.sourceDocumentId);
    form.append('snapshotToken', options.snapshotToken ?? createDocumentExportSnapshotToken({
      documentId: options.sourceDocumentId,
      documentName: 'Server document',
      projectId: options.projectId ?? projectId,
      folderId: null,
      markdown: 'Latest server markdown',
      token: { epoch: 1, revision: 2 },
    }));
  }
  form.append('libraryName', 'Story');
  form.append('file', new File([options.fileContent ?? 'Story'], 'story.txt', { type: 'text/plain' }));
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
    mockedGetDocumentExportSource.mockResolvedValue({
      documentId,
      documentName: 'Server document',
      projectId,
      folderId: null,
      markdown: 'Latest server markdown',
      token: { epoch: 1, revision: 2 },
      snapshotToken: createDocumentExportSnapshotToken({
        documentId,
        documentName: 'Server document',
        projectId,
        folderId: null,
        markdown: 'Latest server markdown',
        token: { epoch: 1, revision: 2 },
      }),
    });
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

  it('logs only sanitized story LLM telemetry', async () => {
    const info = jest.spyOn(console, 'info').mockImplementation(() => undefined);
    mockedResolve.mockImplementation(async (_source, options) => {
      options?.onLlmTelemetry?.({
        stage: 'Auditor',
        attempt: 1,
        elapsedMs: 25,
        outcome: 'success',
        requestId: 'request-123',
      });
      return { document } as never;
    });

    await records(await POST(request()));

    expect(info).toHaveBeenCalledWith('[import-script:llm]', {
      stage: 'Auditor',
      attempt: 1,
      elapsedMs: 25,
      outcome: 'success',
      requestId: 'request-123',
    });
    expect(JSON.stringify(info.mock.calls)).not.toContain('Bearer token');
    expect(JSON.stringify(info.mock.calls)).not.toContain('Story');
  });

  it('streams a terminal error and performs no import when audit fails', async () => {
    mockedResolve.mockRejectedValue(new Error('Semantic audit failed'));

    const response = await POST(request());
    expect(await records(response)).toEqual([{ type: 'error', error: 'Semantic audit failed' }]);
    expect(mockedImport).not.toHaveBeenCalled();
  });

  it('allows a root document source and validates it before converting the frozen text', async () => {
    const response = await POST(request({
      folderId: null,
      sourceDocumentId: documentId,
      fileContent: 'Frozen modal markdown',
    }));

    expect(response.status).toBe(200);
    expect((await records(response)).at(-1)).toEqual({
      type: 'result',
      result: { libraryId: 'library-1', rowCount: 1, fieldCount: 11 },
    });
    expect(mockedGetDocumentExportSource).toHaveBeenCalledWith(
      expect.anything(),
      'user-1',
      documentId
    );
    expect(mockedGetDocumentExportSource.mock.invocationCallOrder[0]).toBeLessThan(
      mockedResolve.mock.invocationCallOrder[0]
    );
    expect(mockedResolve).toHaveBeenCalledWith(
      'Latest server markdown',
      expect.any(Object)
    );
    expect(mockedImport).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      projectId,
      folderId: null,
      document,
      documentSource: { sourceDocumentId: documentId, exportType: 'script' },
    }));
  });

  it('rejects document exports from another project before conversion or writing', async () => {
    mockedGetDocumentExportSource.mockResolvedValue({
      documentId,
      documentName: 'Other project document',
      projectId: '66666666-6666-4666-8666-666666666666',
      folderId: null,
      markdown: 'Other project markdown',
      token: { epoch: 1, revision: 1 },
    });

    const response = await POST(request({ folderId: null, sourceDocumentId: documentId }));

    expect(response.status).not.toBe(200);
    expect(mockedResolve).not.toHaveBeenCalled();
    expect(mockedImport).not.toHaveBeenCalled();
  });

  it('rejects a tampered document snapshot before conversion or writing', async () => {
    const valid = createDocumentExportSnapshotToken({
      documentId,
      documentName: 'Server document',
      projectId,
      folderId: null,
      markdown: 'Latest server markdown',
      token: { epoch: 1, revision: 2 },
    });
    const response = await POST(request({
      folderId: null,
      sourceDocumentId: documentId,
      snapshotToken: `${valid.slice(0, -1)}0`,
    }));

    expect(response.status).toBe(400);
    expect(mockedResolve).not.toHaveBeenCalled();
    expect(mockedImport).not.toHaveBeenCalled();
  });

  it('rejects non-admin document exports before conversion or writing', async () => {
    mockedGetDocumentExportSource.mockRejectedValue(
      new Error('Only admin users can export project content')
    );

    const response = await POST(request({ folderId: null, sourceDocumentId: documentId }));

    expect(response.status).toBe(403);
    expect(mockedResolve).not.toHaveBeenCalled();
    expect(mockedImport).not.toHaveBeenCalled();
  });

  it.each([
    'Project not found',
    'collaborator query failed: database details',
  ])('does not expose AuthorizationError details: %s', async (internalMessage) => {
    const error = new Error(internalMessage);
    error.name = 'AuthorizationError';
    mockedGetDocumentExportSource.mockRejectedValue(error);

    const response = await POST(request({ folderId: null, sourceDocumentId: documentId }));

    expect(response.status).toBe(403);
    const payload = await response.json();
    expect(payload).toEqual({ error: 'Only admin users can export project content' });
    expect(JSON.stringify(payload)).not.toContain(internalMessage);
    expect(mockedResolve).not.toHaveBeenCalled();
    expect(mockedImport).not.toHaveBeenCalled();
  });

  it('still requires a UUID folder for ordinary imports', async () => {
    const response = await POST(request({ folderId: null }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid folderId' });
    expect(mockedGetDocumentExportSource).not.toHaveBeenCalled();
    expect(mockedResolve).not.toHaveBeenCalled();
    expect(mockedImport).not.toHaveBeenCalled();
  });

  it('rejects an invalid source document id before source lookup', async () => {
    const response = await POST(request({ folderId: null, sourceDocumentId: 'not-a-uuid' }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid sourceDocumentId' });
    expect(mockedGetDocumentExportSource).not.toHaveBeenCalled();
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
