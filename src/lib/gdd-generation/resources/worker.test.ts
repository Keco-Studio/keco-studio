import { describe, expect, it, jest } from '@jest/globals';
jest.mock('server-only', () => ({}));
jest.mock('@/lib/documents/documentContentCodec', () => ({
  documentContentCodec: { markdownToYjsState: jest.fn(async () => 'encoded-yjs') },
}));
import {
  processNextGddResourceJob,
} from './worker';

function resourceJob(kind: 'maps' | 'tables' | 'dialogue', payload: Record<string, unknown>) {
  return {
    id: 'resource-1', gdd_generation_job_id: 'job-1', project_id: 'project-1', document_id: 'document-1',
    kind, payload, status: 'running' as const,
    attempt_count: 1, max_attempts: 3, available_at: new Date().toISOString(), lease_owner: 'worker-1',
    lease_expires_at: new Date(Date.now() + 300_000).toISOString(), error: null, completed_at: null,
  };
}

function serviceClientWithoutSeries() {
  const query: Record<string, jest.Mock> = {};
  query.select = jest.fn(() => query);
  query.eq = jest.fn(() => query);
  query.maybeSingle = jest.fn(async () => ({ data: null, error: null }));
  return { from: jest.fn(() => query) };
}

const usageBindingForJob = jest.fn(async (_client: unknown, job: { id: string; project_id: string; gdd_generation_job_id: string }, feature: string) => ({
  context: {
    actorUserId: 'user-1', projectId: job.project_id, feature, operation: 'resource',
    correlationId: job.gdd_generation_job_id, jobId: job.gdd_generation_job_id, artifactId: job.id,
  },
  recorder: jest.fn(async () => undefined),
}));

describe('GDD resource worker', () => {
  it('compiles queued map resources without changing the parent GDD status', async () => {
    const claim = jest.fn(async () => resourceJob('maps', { markdown: '# GDD', artStyle: null }));
    const finish = jest.fn(async (..._args: unknown[]) => 'completed' as const);
    const retry = jest.fn(async (..._args: unknown[]) => 'queued' as const);
    const compile = jest.fn(async (..._args: unknown[]) => []);
    const materialize = jest.fn(async (..._args: unknown[]) => undefined);
    const readDocument = jest.fn(async () => ({
      markdown: '# GDD\n\n<!-- KECO_TABLE_REF Skills -->', yjsState: 'old-yjs',
    }));
    const review = jest.fn(async (..._args: unknown[]) => ({ tablePlans: [], dialoguePlans: [] })) as never;

    await expect(processNextGddResourceJob({ serviceClient: {} as never, workerId: 'worker-1' }, {
      claim, finish, retry, compile, materialize, review, usageBindingForJob,
    })).resolves.toEqual({ claimed: true, jobId: 'resource-1', status: 'completed' });
    expect(compile).toHaveBeenCalledWith(expect.objectContaining({ markdown: '# GDD', artStyle: null, usageBinding: expect.any(Object) }));
    expect(finish).toHaveBeenCalledWith(expect.anything(), {
      jobId: 'resource-1', workerId: 'worker-1', status: 'completed',
    });
  });

  it('writes generated map references into the latest GDD snapshot', async () => {
    const claim = jest.fn(async () => resourceJob('maps', {
      markdown: '# GDD\n\n## Palace Map\nRoutes and landmarks.', artStyle: null,
    }));
    const materializeMaps = jest.fn(async (..._args: unknown[]) => undefined);
    const compile = jest.fn(async () => [{
      id: '11111111-1111-4111-8111-111111111111', title: 'Palace Map', mapType: 'region',
      sourceHeading: 'Palace Map', purpose: 'Navigation', spatialLayout: 'A central court with four wings.',
      regions: ['Court'], routes: ['Main route'], landmarks: ['Gate'], gameplayRequirements: ['Readable paths'],
      visualDescription: 'Top-down palace.', outputSize: '512x512', priority: 1,
      createMapDescription: 'Top-down palace map with clear routes.', styleContract: null,
    }]);

    await processNextGddResourceJob({ serviceClient: {} as never, workerId: 'worker-1' }, {
      claim,
      finish: jest.fn(async () => 'completed' as const),
      retry: jest.fn(async () => 'queued' as const),
      compile: compile as never,
      materialize: jest.fn(async () => undefined),
      materializeMaps,
      readDocument: jest.fn(async () => ({
        markdown: '# GDD\n\n## Palace Map\nRoutes and landmarks.', yjsState: 'old-yjs',
      })),
      review: jest.fn(async () => ({ tablePlans: [], dialoguePlans: [] })) as never,
      usageBindingForJob,
    });

    expect(materializeMaps).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      documentId: 'document-1',
      markdown: expect.stringContaining('<GddMapReference '),
      yjsState: 'encoded-yjs',
      mapArtifacts: [expect.objectContaining({ title: 'Palace Map' })],
    }));
  });

  it('strictly reviews and materializes repaired guided tables in the background', async () => {
    const gddInput = {
      resourceMode: 'async',
      designSystemId: 'system-1',
      rules: { tableGuidance: [{ table: 'MapPuzzles', purpose: 'Map puzzle data.', fields: ['id', 'clueId'] }] },
    };
    const claim = jest.fn(async () => resourceJob('tables', { markdown: '# GDD', input: gddInput }));
    const finish = jest.fn(async (..._args: unknown[]) => 'completed' as const);
    const retry = jest.fn(async (..._args: unknown[]) => 'queued' as const);
    const compile = jest.fn(async (..._args: unknown[]) => []);
    const materialize = jest.fn(async (..._args: unknown[]) => undefined);
    const readDocument = jest.fn(async () => ({
      markdown: '# GDD\n\n<!-- KECO_TABLE_REF MapPuzzles -->', yjsState: 'old-yjs',
    }));
    const reviewMock = jest.fn(async (..._args: unknown[]) => ({
      tablePlans: [{
        table: 'MapPuzzles', purpose: 'Map puzzle data.', fields: ['id', 'clueId'],
        rows: [{ name: 'puzzle-1', values: { id: 'puzzle-1', clueId: 'clue-1' } }],
      }],
      dialoguePlans: [],
    }));
    const review = reviewMock as never;

    await expect(processNextGddResourceJob({
      serviceClient: serviceClientWithoutSeries() as never,
      workerId: 'worker-1',
    }, { claim, finish, retry, compile, materialize, readDocument, review, usageBindingForJob })).resolves.toEqual({
      claimed: true, jobId: 'resource-1', status: 'completed',
    });

    expect(reviewMock).toHaveBeenCalledWith(
      { ...gddInput, resourceMode: 'inline' }, '# GDD', expect.objectContaining({ usageBinding: expect.any(Object) }), { recoverDialogue: false },
    );
    expect(materialize).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      jobId: 'job-1',
      documentId: 'document-1',
      tableResources: [expect.objectContaining({ table: 'MapPuzzles', fields: ['id', 'clueId'] })],
    }));
    expect(retry).not.toHaveBeenCalled();
  });

  it('materializes only table references in a table resource job', async () => {
    const gddInput = {
      resourceMode: 'async', projectId: 'project-1', designSystemId: 'system-1',
      rules: { tableGuidance: [{ table: 'Skills', purpose: 'Actions.', fields: ['name'] }] },
    };
    const claim = jest.fn(async () => resourceJob('tables', {
      markdown: '# GDD\n\n<!-- KECO_TABLE_REF Skills -->', input: gddInput,
    }));
    const finish = jest.fn(async () => 'completed' as const);
    const retry = jest.fn(async () => 'queued' as const);
    const materialize = jest.fn(async (..._args: unknown[]) => undefined);
    const readDocument = jest.fn(async () => ({
      markdown: '# GDD\n\n<!-- KECO_TABLE_REF Skills -->', yjsState: 'old-yjs',
    }));
    const reviewMock = jest.fn(async (..._args: unknown[]) => ({
      tablePlans: [{ table: 'Skills', purpose: 'Actions.', fields: ['name'], rows: [{ name: 'Basic', values: { name: 'Basic' } }] }],
      dialoguePlans: [{ chapterKey: 'intro', title: 'Intro', content: 'Ada: Hello.', hasChoices: false, branchSummary: [] }],
    }));
    const review = reviewMock as never;

    await processNextGddResourceJob({ serviceClient: serviceClientWithoutSeries() as never, workerId: 'worker-1' }, {
      claim, finish, retry, compile: jest.fn(async () => []), materialize, readDocument, review, usageBindingForJob,
    });

    expect(materialize).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      markdown: expect.stringContaining('<ResourceReference kind="table-row"'),
      yjsState: expect.any(String),
      dialogueResources: [],
    }));
    expect((materialize.mock.calls[0]![1] as { markdown: string }).markdown).not.toContain('## Dialogue Resources');
    expect(reviewMock).toHaveBeenCalledWith(
      { ...gddInput, resourceMode: 'inline' },
      '# GDD\n\n<!-- KECO_TABLE_REF Skills -->',
      expect.objectContaining({ usageBinding: expect.any(Object) }),
      { recoverDialogue: false },
    );
  });

  it('materializes dialogue documents without a table resource job', async () => {
    const dialoguePlans = [{
      chapterKey: 'intro', title: 'Intro', content: 'Ada: Hello.', hasChoices: false, branchSummary: [],
    }];
    const claim = jest.fn(async () => resourceJob('dialogue', { dialoguePlans }));
    const materialize = jest.fn(async (..._args: unknown[]) => undefined);

    await processNextGddResourceJob({ serviceClient: {} as never, workerId: 'worker-1' }, {
      claim,
      finish: jest.fn(async () => 'completed' as const),
      retry: jest.fn(async () => 'queued' as const),
      compile: jest.fn(async () => []),
      materialize,
      readDocument: jest.fn(async () => ({ markdown: '# GDD\n\n## Intro\nScene.', yjsState: 'old-yjs' })),
      review: jest.fn() as never,
    });

    expect(materialize).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      jobId: 'job-1',
      documentId: 'document-1',
      expectedMarkdown: '# GDD\n\n## Intro\nScene.',
      tableResources: [],
      dialogueResources: [expect.objectContaining({ chapterKey: 'intro', title: 'Intro' })],
      markdown: expect.stringContaining('## Dialogue Resources'),
      yjsState: 'encoded-yjs',
    }));
  });

  it('retries only the resource job when strict guided-table repair remains incomplete', async () => {
    const gddInput = {
      resourceMode: 'async',
      designSystemId: 'system-1',
      rules: { tableGuidance: [{ table: 'Clues', purpose: 'Clue data.', fields: ['id', 'text'] }] },
    };
    const claim = jest.fn(async () => resourceJob('tables', { markdown: '# GDD', input: gddInput }));
    const finish = jest.fn(async (..._args: unknown[]) => 'completed' as const);
    const retry = jest.fn(async (..._args: unknown[]) => 'queued' as const);
    const compile = jest.fn(async (..._args: unknown[]) => []);
    const materialize = jest.fn(async (..._args: unknown[]) => undefined);
    const reviewMock = jest.fn(async (input: { resourceMode?: string }, ..._args: unknown[]) => {
      if (input.resourceMode === 'inline') {
        throw new Error('GDD is missing required guided tables after one repair pass: Clues.');
      }
      return {
        tablePlans: [{ table: 'Clues', purpose: 'Clue data.', fields: ['id'], rows: [] }],
        dialoguePlans: [],
      };
    });
    const review = reviewMock as never;

    await expect(processNextGddResourceJob({ serviceClient: {} as never, workerId: 'worker-1' }, {
      claim, finish, retry, compile, materialize, review, usageBindingForJob,
    })).resolves.toEqual({ claimed: true, jobId: 'resource-1', status: 'queued' });

    expect(reviewMock).toHaveBeenCalledWith(
      { ...gddInput, resourceMode: 'inline' }, '# GDD', expect.objectContaining({ usageBinding: expect.any(Object) }), { recoverDialogue: false },
    );
    expect(materialize).not.toHaveBeenCalled();
    expect(finish).not.toHaveBeenCalled();
    expect(retry).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      jobId: 'resource-1',
      workerId: 'worker-1',
      error: expect.stringContaining('Clues'),
    }));
  });
});
