import { describe, expect, it, jest } from '@jest/globals';
import {
  claimGddGenerationJob,
  createGddGenerationJob,
  GddIdempotencyConflictError,
} from './gddGenerationService';

describe('gddGenerationService', () => {
  it('returns an existing job for the same idempotency payload', async () => {
    const existing = { id: 'job-1', input_hash: 'hash-a', status: 'queued' };
    const maybeSingle = jest.fn(async () => ({ data: existing, error: null }));
    const from = jest.fn(() => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle }) }) }) }));
    const job = await createGddGenerationJob({ from } as never, {
      ownerId: 'user-1', projectId: 'project-1', designSystemId: 'system-1', versionId: 'version-1',
      input: { projectName: 'Game' } as never, idempotencyKey: 'request-1', inputHash: 'hash-a',
    });
    expect(job).toBe(existing);
  });

  it('rejects an idempotency key reused with different input', async () => {
    const maybeSingle = jest.fn(async () => ({ data: { id: 'job-1', input_hash: 'hash-a' }, error: null }));
    const from = jest.fn(() => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle }) }) }) }));
    await expect(createGddGenerationJob({ from } as never, {
      ownerId: 'user-1', projectId: 'project-1', designSystemId: 'system-1', versionId: 'version-1',
      input: { projectName: 'Other' } as never, idempotencyKey: 'request-1', inputHash: 'hash-b',
    })).rejects.toBeInstanceOf(GddIdempotencyConflictError);
  });

  it('claims jobs only through the service-role lease RPC', async () => {
    const rpc = jest.fn(async (_name: string, _args: unknown) => ({ data: [{ id: 'job-1', lease_owner: 'worker-1' }], error: null }));
    const job = await claimGddGenerationJob({ rpc } as never, 'worker-1');
    expect(job?.id).toBe('job-1');
    expect(rpc).toHaveBeenCalledWith('claim_gdd_generation_job', {
      p_worker_id: 'worker-1',
      p_lease_seconds: 90,
    });
  });
});
