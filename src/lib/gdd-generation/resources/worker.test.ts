import { describe, expect, it, jest } from '@jest/globals';
jest.mock('server-only', () => ({}));
import {
  processNextGddResourceJob,
} from './worker';

describe('GDD resource worker', () => {
  it('compiles queued map resources without changing the parent GDD status', async () => {
    const claim = jest.fn(async () => ({
      id: 'resource-1', gdd_generation_job_id: 'job-1', project_id: 'project-1', document_id: 'document-1',
      kind: 'maps' as const, payload: { markdown: '# GDD', artStyle: null }, status: 'running' as const,
      attempt_count: 1, max_attempts: 3, available_at: new Date().toISOString(), lease_owner: 'worker-1',
      lease_expires_at: new Date(Date.now() + 300_000).toISOString(), error: null, completed_at: null,
    }));
    const finish = jest.fn(async (..._args: unknown[]) => 'completed' as const);
    const retry = jest.fn(async (..._args: unknown[]) => 'queued' as const);
    const compile = jest.fn(async (..._args: unknown[]) => []);
    const materialize = jest.fn(async (..._args: unknown[]) => undefined);

    await expect(processNextGddResourceJob({ serviceClient: {} as never, workerId: 'worker-1' }, {
      claim, finish, retry, compile, materialize,
    })).resolves.toEqual({ claimed: true, jobId: 'resource-1', status: 'completed' });
    expect(compile).toHaveBeenCalledWith({ markdown: '# GDD', artStyle: null });
    expect(finish).toHaveBeenCalledWith(expect.anything(), {
      jobId: 'resource-1', workerId: 'worker-1', status: 'completed',
    });
  });
});
