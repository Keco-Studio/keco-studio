import { describe, expect, it, jest } from '@jest/globals';

jest.mock('server-only', () => ({}));
jest.mock('@/lib/documents/documentStateGateway', () => ({
  documentStateGateway: { read: jest.fn() },
}));
jest.mock('@/lib/services/scriptConversionService', () => ({
  resolveStoryForImport: jest.fn(),
}));
jest.mock('@/lib/services/scriptImportService', () => ({
  importStoryDocument: jest.fn(),
}));
jest.mock('@/lib/documents/serverDocumentReplacement', () => ({
  replaceDialogueReference: jest.fn(),
}));

import { documentStateGateway } from '@/lib/documents/documentStateGateway';
import { resolveStoryForImport } from '@/lib/services/scriptConversionService';
import { importStoryDocument } from '@/lib/services/scriptImportService';
import { replaceDialogueReference } from '@/lib/documents/serverDocumentReplacement';
import {
  processClaimedDialogueJob,
  processNextDialogueJob,
  describeDialogueGenerationError,
} from './dialogueWorker';

const job = {
  id: 'job-1', project_id: 'project-1', gdd_generation_job_id: 'gdd-1',
  chapter_key: 'chapter-1', title: 'Arrival', source_content: 'Frozen source',
  document_id: 'document-1', script_library_id: null, status: 'running',
  attempt_count: 1, max_attempts: 3, available_at: new Date().toISOString(),
  lease_owner: 'worker-1', lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
  last_error: null, completed_at: null,
} as any;

describe('dialogue generation worker', () => {
  it('converts current Document content through Story IR and completes the Script job', async () => {
    jest.mocked(documentStateGateway.read).mockResolvedValue({
      markdown: 'Edited dialogue', token: { epoch: 1, revision: 2 },
      updateTail: [{ id: 'update-1' }],
    } as any);
    jest.mocked(resolveStoryForImport).mockResolvedValue({ document: { nodes: [] }, plotPlan: { nodes: [] } } as any);
    jest.mocked(importStoryDocument).mockResolvedValue({ libraryId: 'library-1', rowCount: 2, fieldCount: 4 });
    const heartbeat = jest.fn(async () => undefined);
    const complete = jest.fn(async () => true);
    const updateReference = jest.fn(async () => undefined);
    const resolveOwner = jest.fn(async () => 'user-1');
    const findExistingScript = jest.fn(async () => null);
    const result = await processClaimedDialogueJob({ serviceClient: {} as never, workerId: 'worker-1', job }, {
      heartbeat, complete, updateReference, resolveOwner, findExistingScript, fail: jest.fn(async () => true), retry: jest.fn(async () => 'queued' as const),
    } as any);
    expect(result).toBe('completed');
    expect(resolveStoryForImport).toHaveBeenCalledWith('Edited dialogue', expect.objectContaining({
      skipSemanticAuditAfterValidation: true, enableAiPlotPlanning: false,
    }));
    expect(importStoryDocument).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      projectId: 'project-1', userId: 'user-1', folderId: null,
      libraryName: 'Arrival Script (chapter-1)',
      document: { nodes: [] }, plotPlan: { nodes: [] },
      documentSource: { sourceDocumentId: 'document-1', exportType: 'script' },
      dialogueGenerationJobId: 'job-1',
      dialogueGenerationWorkerId: 'worker-1',
      dialogueSourceState: { epoch: 1, revision: 2, updateIds: ['update-1'] },
    }));
    expect(complete).not.toHaveBeenCalled();
    expect(updateReference as jest.Mock).toHaveBeenCalledWith(expect.anything(), job, 'library-1');
  });

  it('keeps the source Document and retries transient conversion failures', async () => {
    jest.mocked(documentStateGateway.read).mockResolvedValue({ markdown: 'Edited dialogue' } as any);
    jest.mocked(resolveStoryForImport).mockRejectedValue(new Error('provider unavailable'));
    const retry = jest.fn(async () => 'queued' as const);
    await expect(processClaimedDialogueJob({ serviceClient: {} as never, workerId: 'worker-1', job }, {
      heartbeat: jest.fn(async () => undefined), complete: jest.fn(async () => true),
      resolveOwner: jest.fn(async () => 'user-1'), findExistingScript: jest.fn(async () => null), fail: jest.fn(async () => true), retry,
    } as any)).resolves.toBe('queued');
    expect(retry as jest.Mock).toHaveBeenCalledWith(expect.anything(), 'job-1', 'worker-1', 'provider unavailable', expect.any(Number));
  });

  it('repairs the GDD reference when recovering an already imported Script', async () => {
    const complete = jest.fn(async () => true);
    const updateReference = jest.fn(async () => undefined);
    await expect(processClaimedDialogueJob({ serviceClient: {} as never, workerId: 'worker-1', job }, {
      heartbeat: jest.fn(async () => undefined),
      findExistingScript: jest.fn(async () => 'library-existing'),
      complete,
      updateReference,
    } as any)).resolves.toBe('completed');
    expect(complete as jest.Mock).toHaveBeenCalledWith(expect.anything(), 'job-1', 'worker-1', 'library-existing');
    expect(updateReference as jest.Mock).toHaveBeenCalledWith(expect.anything(), job, 'library-existing');
    expect(replaceDialogueReference).not.toHaveBeenCalled();
  });

  it('deletes a non-ready Script before regenerating instead of completing from partial data', async () => {
    const deleteFilters: Array<[string, unknown]> = [];
    const serviceClient = {
      from: jest.fn(() => {
        let deleting = false;
        const query = {
          select: jest.fn(() => query),
          delete: jest.fn(() => { deleting = true; return query; }),
          eq: jest.fn((column: string, value: unknown) => {
            if (deleting) deleteFilters.push([column, value]);
            return query;
          }),
          maybeSingle: jest.fn(async () => ({
            data: { id: 'partial-library', dialogue_generation_ready: false },
            error: null,
          })),
          then: (resolve: (value: unknown) => void) => resolve({ data: null, error: null }),
        };
        return query;
      }),
    } as any;
    const importStory = jest.fn(async () => ({ libraryId: 'library-new', rowCount: 2, fieldCount: 4 }));
    await expect(processClaimedDialogueJob({ serviceClient, workerId: 'worker-1', job }, {
      heartbeat: jest.fn(async () => undefined),
      complete: jest.fn(async () => true),
      read: jest.fn(async () => ({ markdown: 'Edited dialogue' } as any)),
      resolve: jest.fn(async () => ({ document: { nodes: [] }, plotPlan: { nodes: [] } } as any)),
      importStory,
      resolveOwner: jest.fn(async () => 'user-1'),
      updateReference: jest.fn(async () => undefined),
      fail: jest.fn(async () => true),
      retry: jest.fn(async () => 'queued' as const),
    })).resolves.toBe('completed');
    expect(deleteFilters).toEqual(expect.arrayContaining([
      ['id', 'partial-library'],
      ['dialogue_generation_job_id', 'job-1'],
      ['dialogue_generation_ready', false],
    ]));
    expect(importStory).toHaveBeenCalled();
  });

  it('keeps the lease alive while Story conversion is running', async () => {
    jest.useFakeTimers();
    let finishConversion!: (value: any) => void;
    let finishImport!: (value: { libraryId: string; rowCount: number; fieldCount: number }) => void;
    const conversion = new Promise<any>((resolve) => { finishConversion = resolve; });
    const imported = new Promise<{ libraryId: string; rowCount: number; fieldCount: number }>((resolve) => { finishImport = resolve; });
    jest.mocked(documentStateGateway.read).mockResolvedValue({ markdown: 'Long dialogue' } as any);
    jest.mocked(resolveStoryForImport).mockReturnValueOnce(conversion);
    jest.mocked(importStoryDocument).mockReturnValueOnce(imported);
    const heartbeat = jest.fn(async () => undefined);
    const running = processClaimedDialogueJob({ serviceClient: {} as never, workerId: 'worker-1', job }, {
      heartbeat,
      complete: jest.fn(async () => true),
      updateReference: jest.fn(async () => undefined),
      resolveOwner: jest.fn(async () => 'user-1'),
      findExistingScript: jest.fn(async () => null),
      fail: jest.fn(async () => true),
      retry: jest.fn(async () => 'queued' as const),
    } as any);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(30_000);
    expect(heartbeat).toHaveBeenCalledTimes(3);
    finishConversion({ document: { nodes: [] }, plotPlan: { nodes: [] } });
    await Promise.resolve();
    await Promise.resolve();
    const heartbeatsBeforeImportWait = heartbeat.mock.calls.length;
    await jest.advanceTimersByTimeAsync(60_000);
    expect(heartbeat.mock.calls.length).toBeGreaterThanOrEqual(heartbeatsBeforeImportWait + 2);
    finishImport({ libraryId: 'library-1', rowCount: 2, fieldCount: 4 });
    await expect(running).resolves.toBe('completed');
    jest.useRealTimers();
  });

  it('claims and processes one job', async () => {
    const claim = jest.fn(async () => job);
    const process = jest.fn(async () => 'completed' as const);
    await expect(processNextDialogueJob({ serviceClient: {} as never, workerId: 'worker-1' }, { claim, process } as any)).resolves.toEqual({ claimed: true, jobId: 'job-1', status: 'completed' });
    expect(process as jest.Mock).toHaveBeenCalledWith({ serviceClient: {}, workerId: 'worker-1', job });
  });

  it('bounds structured errors', () => {
    expect(describeDialogueGenerationError({ message: 'x', details: 'y', code: '22023' })).toBe('x: y [22023]');
  });
});
