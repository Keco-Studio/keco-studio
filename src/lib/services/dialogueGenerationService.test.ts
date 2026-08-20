import { describe, expect, it, jest } from '@jest/globals';
import {
  claimDialogueGenerationJob,
  heartbeatDialogueGenerationJob,
  completeDialogueGenerationJob,
  failDialogueGenerationJob,
  retryDialogueGenerationJob,
  listDialogueGenerationJobs,
} from './dialogueGenerationService';

describe('dialogue generation service', () => {
  it('passes lease and completion transitions through the durable RPCs', async () => {
    const rpc = jest.fn(async (name: string) => ({
      data: name === 'claim_dialogue_generation_job'
        ? [{ id: 'job-1', status: 'running' }]
        : name === 'retry_dialogue_generation_job'
          ? [{
              id: 'job-1', status: 'queued', source_content: 'secret',
              lease_owner: 'worker-1', lease_expires_at: 'tomorrow',
            }]
          : true,
      error: null,
    }));
    const client = { rpc } as never;

    await expect(claimDialogueGenerationJob(client, 'worker-1', 45)).resolves.toEqual({ id: 'job-1', status: 'running' });
    await expect(heartbeatDialogueGenerationJob(client, 'job-1', 'worker-1', 45)).resolves.toBeUndefined();
    await expect(completeDialogueGenerationJob(client, 'job-1', 'worker-1', 'library-1')).resolves.toEqual({
      scriptLibraryId: 'library-1', action: 'reused',
    });
    await expect(failDialogueGenerationJob(client, 'job-1', 'worker-1', 'conversion failed', 30)).resolves.toBe(true);
    await expect(retryDialogueGenerationJob(client, 'job-1', 'user-1')).resolves.toEqual(expect.objectContaining({
      id: 'job-1', status: 'queued',
    }));
    const retried = await retryDialogueGenerationJob(client, 'job-1', 'user-1');
    expect(retried).not.toHaveProperty('source_content');
    expect(retried).not.toHaveProperty('lease_owner');
    expect(retried).not.toHaveProperty('lease_expires_at');

    expect(rpc as jest.Mock).toHaveBeenNthCalledWith(1, 'claim_dialogue_generation_job', {
      p_worker_id: 'worker-1', p_lease_seconds: 45,
    });
    expect(rpc as jest.Mock).toHaveBeenNthCalledWith(2, 'heartbeat_dialogue_generation_job', {
      p_job_id: 'job-1', p_worker_id: 'worker-1', p_lease_seconds: 45,
    });
    expect(rpc as jest.Mock).toHaveBeenNthCalledWith(3, 'complete_dialogue_generation_job', {
      p_job_id: 'job-1', p_worker_id: 'worker-1', p_script_library_id: 'library-1',
    });
    expect(rpc as jest.Mock).toHaveBeenNthCalledWith(4, 'fail_dialogue_generation_job', {
      p_job_id: 'job-1', p_worker_id: 'worker-1', p_error: 'conversion failed', p_delay_seconds: 30,
    });
    expect(rpc as jest.Mock).toHaveBeenNthCalledWith(5, 'retry_dialogue_generation_job', {
      p_job_id: 'job-1', p_actor_id: 'user-1',
    });
  });

  it('lists only public fields for a project GDD job', async () => {
    const query = {
      select: jest.fn(() => query),
      eq: jest.fn(() => query),
      order: jest.fn(() => query),
      then: (resolve: (value: unknown) => void) => resolve({ data: [{ id: 'job-1', status: 'failed', source_content: 'secret' }], error: null }),
    };
    const jobs = await listDialogueGenerationJobs({ from: jest.fn(() => query) } as never, 'project-1', 'gdd-1');
    expect(jobs).toEqual([{ id: 'job-1', status: 'failed' }]);
    expect(query.eq as jest.Mock).toHaveBeenCalledWith('project_id', 'project-1');
    expect(query.eq as jest.Mock).toHaveBeenCalledWith('gdd_generation_job_id', 'gdd-1');
  });
});
