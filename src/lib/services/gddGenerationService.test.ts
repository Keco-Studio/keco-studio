import { describe, expect, it, jest } from '@jest/globals';
import {
  cancelGddGenerationJob,
  claimGddGenerationJob,
  heartbeatGddMapArtifact,
  reconcileGddMapArtifact,
  createGddGenerationJob,
  getPublicGddGenerationJob,
  getLatestPublicGddGenerationJob,
  GddActiveJobConflictError,
  GddIdempotencyConflictError,
  persistCompletedGddGenerationJob,
  toPublicGddGenerationJob,
} from './gddGenerationService';

describe('gddGenerationService', () => {
  const createInput = {
    ownerId: 'user-1', projectId: 'project-1', designSystemId: 'system-1', versionId: 'version-1',
    input: {
      projectName: 'Game', projectSources: [],
      rules: { rules: [], tableGuidance: [] },
    } as never,
    idempotencyKey: 'request-1', inputHash: 'a'.repeat(64),
  };

  it('creates or recovers a job only through the guarded service-role RPC', async () => {
    const existing = { id: 'job-1', input_hash: 'hash-a', status: 'queued' };
    const rpc = jest.fn(async (_name?: string, _args?: unknown) => ({ data: [existing], error: null }));
    const from = jest.fn(() => ({ select: () => ({ eq: () => ({ order: async () => ({ data: [], error: null }) }) }) }));
    const job = await createGddGenerationJob({ rpc, from } as never, createInput);
    expect(job).toEqual({ ...existing, maps: [] });
    expect(rpc).toHaveBeenCalledWith('create_gdd_generation_job_guarded', expect.objectContaining({
      p_project_id: 'project-1',
      p_input_hash: 'a'.repeat(64),
      p_idempotency_key: 'request-1',
      p_source_snapshots: [],
    }));
  });

  it('rejects an idempotency key reused with different input', async () => {
    const rpc = jest.fn(async () => ({
      data: null,
      error: { code: 'P0001', hint: 'gdd_idempotency_conflict' },
    }));
    await expect(createGddGenerationJob({ rpc } as never, createInput)).rejects.toBeInstanceOf(GddIdempotencyConflictError);
  });

  it('returns the active project job with a different payload conflict', async () => {
    const active = { id: 'job-active', project_id: 'project-1', status: 'running' };
    const rpc = jest.fn(async () => ({
      data: null,
      error: { code: 'P0001', hint: 'gdd_active_job_conflict', details: 'job-active' },
    }));
    const maybeSingle = jest.fn(async () => ({ data: active, error: null }));
    const order = jest.fn(async () => ({ data: [], error: null }));
    const from = jest.fn((table: string) => table === 'gdd_generation_jobs'
      ? { select: () => ({ eq: () => ({ maybeSingle }) }) }
      : { select: () => ({ eq: () => ({ order }) }) });
    await expect(createGddGenerationJob({ rpc, from } as never, createInput)).rejects.toMatchObject({
      name: GddActiveJobConflictError.name,
      job: { id: 'job-active', maps: [] },
    });
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

  it('renews and reconciles GDD map artifact leases through service-role RPCs', async () => {
    const rpc = jest.fn(async (name: string) => ({
      data: name === 'heartbeat_gdd_map_artifact' ? true : 'ready', error: null,
    }));
    await heartbeatGddMapArtifact({ rpc } as never, {
      artifactId: 'artifact-1', workerId: 'worker-1', phase: 'validating',
    });
    await expect(reconcileGddMapArtifact({ rpc } as never, 'artifact-1')).resolves.toBe('ready');
    expect((rpc.mock.calls as unknown[][])[0]).toEqual(['heartbeat_gdd_map_artifact', {
      p_artifact_id: 'artifact-1', p_worker_id: 'worker-1', p_phase: 'validating', p_lease_seconds: 300,
    }]);
    expect((rpc.mock.calls as unknown[][])[1]).toEqual(['reconcile_gdd_map_artifact', { p_artifact_id: 'artifact-1' }]);
  });

  it('cancels an active job and releases its lease', async () => {
    const row = {
      id: 'job-1', project_id: 'project-1', design_system_id: 'system-1', version_id: 'version-1',
      status: 'failed', phase: 'failed', error: 'Generation cancelled by user.', attempt_count: 1,
      max_attempts: 3, available_at: 'available', completed_at: 'completed', output_document_id: null,
      output_document_name: null, applied_rule_ids: [], omitted_rule_ids: [],
    };
    const maybeSingle = jest.fn(async () => ({ data: row, error: null }));
    const select = jest.fn(() => ({ maybeSingle }));
    const inStatus = jest.fn((_column: string, _values: string[]) => ({ select }));
    const eqId = jest.fn(() => ({ in: inStatus }));
    const update = jest.fn((_value: unknown) => ({ eq: eqId }));

    await expect(cancelGddGenerationJob({ from: () => ({ update }) } as never, 'job-1')).resolves.toMatchObject({
      status: 'failed', phase: 'failed', error: 'Generation cancelled by user.',
    });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed', phase: 'failed', lease_owner: null, lease_expires_at: null,
    }));
    expect(inStatus).toHaveBeenCalledWith('status', ['queued', 'running']);
  });

  it('persists the Document and completion through one service-role RPC', async () => {
    const rpc = jest.fn(async (_name: string, _args: unknown) => ({ data: [{ document_id: 'document-1', document_name: 'GDD' }], error: null }));
    await expect(persistCompletedGddGenerationJob({ rpc } as never, {
      jobId: 'job-1', workerId: 'worker-1', markdown: '# GDD', yjsState: 'encoded',
      description: 'Generated', metadata: { source: 'gdd-generation' },
      appliedRuleIds: ['rule-1'], omittedRuleIds: [],
    })).resolves.toEqual({ id: 'document-1', name: 'GDD' });
    expect(rpc).toHaveBeenCalledWith('persist_completed_gdd_generation_job', expect.objectContaining({
      p_job_id: 'job-1', p_worker_id: 'worker-1', p_yjs_state: 'encoded',
    }));
  });

  it('creates an explicit bounded public DTO', () => {
    const publicJob = toPublicGddGenerationJob({
      id: 'job-1', project_id: 'project-1', design_system_id: 'system-1', version_id: 'version-1',
      status: 'failed', phase: 'failed', attempt_count: 3, max_attempts: 3,
      available_at: 'available', completed_at: 'completed', output_document_id: null,
      output_document_name: null, applied_rule_ids: [], omitted_rule_ids: [], error: 'x'.repeat(2000),
      input: { secret: true }, lease_owner: 'worker', idempotency_key: 'secret',
    } as never);
    expect(publicJob.error).toHaveLength(500);
    expect(publicJob).not.toHaveProperty('input');
    expect(publicJob).not.toHaveProperty('lease_owner');
    expect(publicJob).not.toHaveProperty('idempotency_key');
  });

  it('reads public jobs using only the authorized public column list', async () => {
    const maybeSingle = jest.fn(async () => ({ data: { id: 'job-1', status: 'queued' }, error: null }));
    const select = jest.fn((_columns: string) => ({ eq: () => ({ maybeSingle }) }));
    await getPublicGddGenerationJob({ from: () => ({ select }) } as never, 'job-1');

    const columns = select.mock.calls[0][0];
    expect(columns).toContain('output_document_id');
    expect(columns).not.toMatch(/input|source_snapshots|idempotency|hash|lease|owner_id/);
  });

  it('reads the latest public job for a pinned project version', async () => {
    const maybeSingle = jest.fn(async () => ({ data: { id: 'job-2', project_id: 'project-1', created_at: '2026-08-18T00:00:00Z' }, error: null }));
    const limit = jest.fn(() => ({ maybeSingle }));
    const order = jest.fn((_column: string, _options: unknown) => ({ limit }));
    const eqVersion = jest.fn(() => ({ order }));
    const eqSystem = jest.fn(() => ({ eq: eqVersion }));
    const eqProject = jest.fn(() => ({ eq: eqSystem }));
    const select = jest.fn(() => ({ eq: eqProject }));
    const result = await getLatestPublicGddGenerationJob({ from: () => ({ select }) } as never, {
      projectId: 'project-1', designSystemId: 'system-1', versionId: 'version-1',
    });
    expect(result?.id).toBe('job-2');
    expect(result).not.toHaveProperty('created_at');
    expect(order).toHaveBeenCalledWith('created_at', { ascending: false });
  });
});
