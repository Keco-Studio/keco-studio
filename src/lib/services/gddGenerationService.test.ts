import { describe, expect, it, jest } from '@jest/globals';
import {
  cancelGddGenerationJob,
  claimGddGenerationJob,
  createGddGenerationJob,
  getPublicGddGenerationJob,
  getLatestPublicGddGenerationJob,
  GddIdempotencyConflictError,
  persistCompletedGddGenerationJob,
  toPublicGddGenerationJob,
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
      tableResources: [{ id: 'table-1', table: 'Skills', purpose: 'Actions.', fields: ['name'], rows: [{ id: 'row-1', name: 'Basic', values: { name: 'Basic' } }] }],
    })).resolves.toEqual({ id: 'document-1', name: 'GDD' });
    expect(rpc).toHaveBeenCalledWith('persist_completed_gdd_generation_job', expect.objectContaining({
      p_job_id: 'job-1', p_worker_id: 'worker-1', p_yjs_state: 'encoded',
      p_table_resources: [{ id: 'table-1', table: 'Skills', purpose: 'Actions.', fields: ['name'], rows: [{ id: 'row-1', name: 'Basic', values: { name: 'Basic' } }] }],
      p_dialogue_resources: [],
    }));
  });

  it('passes materialized dialogue resources to the completion RPC', async () => {
    const rpc = jest.fn(async (_name: string, _args: unknown) => ({ data: [{ document_id: 'document-1', document_name: 'GDD' }], error: null }));
    const dialogueResources = [{
      chapterKey: 'chapter-01',
      title: 'Arrival',
      content: 'Guide: Hello.',
      hasChoices: false,
      branchSummary: [],
      documentId: 'document-2',
      dialogueJobId: 'dialogue-job-1',
      documentName: 'Arrival dialogue',
    }];
    await persistCompletedGddGenerationJob({ rpc } as never, {
      jobId: 'job-1', workerId: 'worker-1', markdown: '# GDD', yjsState: 'encoded',
      description: 'Generated', metadata: {}, appliedRuleIds: [], omittedRuleIds: [],
      dialogueResources,
    });
    expect(rpc).toHaveBeenCalledWith('persist_completed_gdd_generation_job', expect.objectContaining({
      p_dialogue_resources: [{
        chapterKey: 'chapter-01',
        title: 'Arrival',
        content: 'Guide: Hello.',
        hasChoices: false,
        branchSummary: [],
        documentId: 'document-2',
        dialogueJobId: 'dialogue-job-1',
      }],
    }));
  });

  it('strips model-only metadata before sending table resources to Postgres', async () => {
    const rpc = jest.fn(async (_name: string, _args: unknown) => ({ data: [{ document_id: 'document-1', document_name: 'GDD' }], error: null }));
    const resource = {
      id: 'table-1', table: 'Products', purpose: 'Product catalog data.', fields: ['name', 'category', 'base_cost'],
      modelNote: 'ignore me',
      rows: [{ id: 'row-1', name: 'Milk', category: 'Dairy', base_cost: 10, sourceIndex: 0 }],
    } as never;

    await persistCompletedGddGenerationJob({ rpc } as never, {
      jobId: 'job-1', workerId: 'worker-1', markdown: '# GDD', yjsState: 'encoded',
      description: 'Generated', metadata: {}, appliedRuleIds: [], omittedRuleIds: [], tableResources: [resource],
    });

    expect(rpc.mock.calls[0][1]).toEqual(expect.objectContaining({
      p_table_resources: [{
        id: 'table-1', table: 'Products', purpose: 'Product catalog data.', fields: ['name', 'category', 'base_cost'],
        rows: [{ id: 'row-1', name: 'Milk', values: { name: 'Milk', category: 'Dairy', base_cost: 10 } }],
      }],
    }));
  });

  it('creates an explicit bounded public DTO', () => {
    const publicJob = toPublicGddGenerationJob({
      id: 'job-1', project_id: 'project-1', design_system_id: 'system-1', version_id: 'version-1',
      status: 'failed', phase: 'failed', attempt_count: 3, max_attempts: 3,
      available_at: 'available', completed_at: 'completed', output_document_id: null,
      output_document_name: null, applied_rule_ids: [], omitted_rule_ids: [], error: 'x'.repeat(2000),
      output_folder_id: 'folder-1', output_table_ids: ['table-1'], output_table_names: ['Skills'],
      input: { secret: true }, lease_owner: 'worker', idempotency_key: 'secret',
    } as never);
    expect(publicJob.error).toHaveLength(500);
    expect(publicJob).not.toHaveProperty('input');
    expect(publicJob).not.toHaveProperty('lease_owner');
    expect(publicJob).not.toHaveProperty('idempotency_key');
    expect(publicJob).toEqual(expect.objectContaining({
      output_folder_id: 'folder-1', output_table_ids: ['table-1'], output_table_names: ['Skills'],
    }));
  });

  it('reads public jobs using only the authorized public column list', async () => {
    const maybeSingle = jest.fn(async () => ({ data: { id: 'job-1', status: 'queued' }, error: null }));
    const select = jest.fn((_columns: string) => ({ eq: () => ({ maybeSingle }) }));
    await getPublicGddGenerationJob({ from: () => ({ select }) } as never, 'job-1');

    const columns = select.mock.calls[0][0];
    expect(columns).toContain('output_document_id');
    expect(columns).toContain('output_folder_id');
    expect(columns).toContain('output_table_ids');
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
