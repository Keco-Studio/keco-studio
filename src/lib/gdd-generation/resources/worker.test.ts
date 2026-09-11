import { describe, expect, it, jest } from '@jest/globals';
jest.mock('server-only', () => ({}));
import {
  processNextGddResourceJob,
} from './worker';

function resourceJob(kind: 'maps' | 'tables', payload: Record<string, unknown>) {
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

describe('GDD resource worker', () => {
  it('compiles queued map resources without changing the parent GDD status', async () => {
    const claim = jest.fn(async () => resourceJob('maps', { markdown: '# GDD', artStyle: null }));
    const finish = jest.fn(async (..._args: unknown[]) => 'completed' as const);
    const retry = jest.fn(async (..._args: unknown[]) => 'queued' as const);
    const compile = jest.fn(async (..._args: unknown[]) => []);
    const materialize = jest.fn(async (..._args: unknown[]) => undefined);
    const review = jest.fn(async (..._args: unknown[]) => ({ tablePlans: [], dialoguePlans: [] })) as never;

    await expect(processNextGddResourceJob({ serviceClient: {} as never, workerId: 'worker-1' }, {
      claim, finish, retry, compile, materialize, review,
    })).resolves.toEqual({ claimed: true, jobId: 'resource-1', status: 'completed' });
    expect(compile).toHaveBeenCalledWith({ markdown: '# GDD', artStyle: null });
    expect(finish).toHaveBeenCalledWith(expect.anything(), {
      jobId: 'resource-1', workerId: 'worker-1', status: 'completed',
    });
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
    }, { claim, finish, retry, compile, materialize, review })).resolves.toEqual({
      claimed: true, jobId: 'resource-1', status: 'completed',
    });

    expect(reviewMock).toHaveBeenCalledWith({ ...gddInput, resourceMode: 'inline' }, '# GDD');
    expect(materialize).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      jobId: 'job-1',
      documentId: 'document-1',
      tableResources: [expect.objectContaining({ table: 'MapPuzzles', fields: ['id', 'clueId'] })],
    }));
    expect(retry).not.toHaveBeenCalled();
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
      claim, finish, retry, compile, materialize, review,
    })).resolves.toEqual({ claimed: true, jobId: 'resource-1', status: 'queued' });

    expect(reviewMock).toHaveBeenCalledWith({ ...gddInput, resourceMode: 'inline' }, '# GDD');
    expect(materialize).not.toHaveBeenCalled();
    expect(finish).not.toHaveBeenCalled();
    expect(retry).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      jobId: 'resource-1',
      workerId: 'worker-1',
      error: expect.stringContaining('Clues'),
    }));
  });
});
