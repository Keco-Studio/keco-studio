import { NextRequest } from 'next/server';

const getUserProjectRole = jest.fn();
const getGddGenerationJob = jest.fn();
const getPublicGddGenerationJob = jest.fn();
const createGddGenerationJob = jest.fn();
const cancelGddGenerationJob = jest.fn();
const getGameDesignSystemDetail = jest.fn();
const getSupabaseServiceRoleClient = jest.fn();
const processNextGddJob = jest.fn();
let userId: string | null = 'user-1';
let supabase: any;

jest.mock('next/server', () => {
  const actual = jest.requireActual('next/server') as Record<string, unknown>;
  return { ...actual, after: (callback: () => Promise<void>) => { void callback(); } };
});
jest.mock('server-only', () => ({}));
jest.mock('@/lib/auth/route-auth', () => ({
  withAuth: (handler: Function, options: any = {}) => async (request: NextRequest, context: unknown) => {
    if (!userId) return options.unauthorizedResponse?.() ?? Response.json({ error: 'Please sign in to continue' }, { status: 401 });
    return handler(request, context, { supabase, user: { id: userId } });
  },
}));
jest.mock('@/lib/services/authorizationService', () => ({
  getUserProjectRole: (...args: unknown[]) => getUserProjectRole(...args),
}));
jest.mock('@/lib/services/gddGenerationService', () => {
  const actual = jest.requireActual('@/lib/services/gddGenerationService') as any;
  return {
    ...actual,
    getGddGenerationJob: (...args: unknown[]) => getGddGenerationJob(...args),
    getPublicGddGenerationJob: (...args: unknown[]) => getPublicGddGenerationJob(...args),
    createGddGenerationJob: (...args: unknown[]) => createGddGenerationJob(...args),
    cancelGddGenerationJob: (...args: unknown[]) => cancelGddGenerationJob(...args),
  };
});
jest.mock('@/lib/services/gameDesignSystemService', () => ({
  getGameDesignSystemDetail: (...args: unknown[]) => getGameDesignSystemDetail(...args),
}));
jest.mock('@/lib/server/supabaseServiceRole', () => ({
  getSupabaseServiceRoleClient: () => getSupabaseServiceRoleClient(),
}));
jest.mock('@/lib/gdd-generation/worker', () => ({ processNextGddJob: (...args: unknown[]) => processNextGddJob(...args) }));

import { POST } from '@/app/api/projects/[projectId]/gdd-generation-jobs/route';
import { DELETE, GET } from '@/app/api/projects/[projectId]/gdd-generation-jobs/[id]/route';
import { GddActiveJobConflictError } from '@/lib/services/gddGenerationService';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const SYSTEM_ID = '22222222-2222-4222-8222-222222222222';
const VERSION_ID = '33333333-3333-4333-8333-333333333333';
const JOB_ID = '44444444-4444-4444-8444-444444444444';
const params = { params: Promise.resolve({ projectId: PROJECT_ID, id: JOB_ID }) };

const internalJob = {
  id: JOB_ID, owner_id: 'user-1', project_id: PROJECT_ID, design_system_id: SYSTEM_ID,
  version_id: VERSION_ID, status: 'completed', phase: 'completed', attempt_count: 1,
  max_attempts: 3, available_at: '2026-08-17T00:00:00Z', completed_at: '2026-08-17T00:01:00Z',
  output_document_id: '55555555-5555-4555-8555-555555555555', output_document_name: 'GDD',
  applied_rule_ids: ['rule-1'], omitted_rule_ids: [], error: null,
  input: { secret: 'prompt' }, source_snapshots: [{ excerpt: 'secret source' }],
  idempotency_key: 'private-key', input_hash: 'private-hash', lease_owner: 'private-worker',
  lease_expires_at: 'private', heartbeat_at: 'private', started_at: 'private', created_at: 'private', updated_at: 'private',
};
const publicJob = {
  id: JOB_ID, project_id: PROJECT_ID, design_system_id: SYSTEM_ID, version_id: VERSION_ID,
  status: 'completed', phase: 'completed', attempt_count: 1, max_attempts: 3,
  available_at: '2026-08-17T00:00:00Z', completed_at: '2026-08-17T00:01:00Z',
  output_document_id: '55555555-5555-4555-8555-555555555555', output_document_name: 'GDD',
  applied_rule_ids: ['rule-1'], omitted_rule_ids: [], error: null,
};

describe('project GDD generation routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    userId = 'user-1';
    getUserProjectRole.mockResolvedValue({ role: 'editor', isOwner: false });
    getGddGenerationJob.mockResolvedValue(internalJob);
    getPublicGddGenerationJob.mockResolvedValue(publicJob);
    createGddGenerationJob.mockResolvedValue(internalJob);
    cancelGddGenerationJob.mockResolvedValue({ ...publicJob, status: 'failed', phase: 'failed', error: 'Generation cancelled by user.' });
    getSupabaseServiceRoleClient.mockReturnValue({ service: true });
    processNextGddJob.mockResolvedValue({ claimed: true, jobId: JOB_ID, status: 'completed' });
    supabase = {
      from: (table: string) => {
        if (table === 'project_game_design_systems') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { design_system_id: SYSTEM_ID, version_id: VERSION_ID }, error: null }) }) }) };
        if (table === 'projects') return { select: () => ({ eq: () => ({ single: async () => ({ data: { name: 'Project' }, error: null }) }) }) };
        throw new Error(`unexpected table ${table}`);
      },
    };
    getGameDesignSystemDetail.mockResolvedValue({
      id: SYSTEM_ID, title: 'System', migration_status: 'ready',
      versions: [{
        id: VERSION_ID, version_number: 1, conflicts: [], source_snapshots: [],
        document: { designIntent: 'a', playerFantasy: 'b', coreLoop: 'c', decisionStructure: 'd', systemBoundaries: 'e', progressionEconomy: 'f', contentModel: 'g', difficultyBalance: 'h', experiencePresentation: 'i' },
        rules: { schemaVersion: 1, genres: [], philosophies: [], suitableFor: 'games', rules: [{ id: 'rule-1', kind: 'principle', title: 'Rule', statement: 'Do it', appliesWhen: 'Always', severity: 'required' }], tableGuidance: [] },
      }],
    });
  });

  it('rejects viewers from reading a job', async () => {
    getUserProjectRole.mockResolvedValue({ role: 'viewer', isOwner: false });
    const response = await GET(new NextRequest(`https://example.test/api/projects/${PROJECT_ID}/gdd-generation-jobs/${JOB_ID}`), params);

    expect(response.status).toBe(403);
    expect(getPublicGddGenerationJob).not.toHaveBeenCalled();
  });

  it('returns a bounded public DTO without internal job fields from GET', async () => {
    const response = await GET(new NextRequest(`https://example.test/api/projects/${PROJECT_ID}/gdd-generation-jobs/${JOB_ID}`), params);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.job).toEqual(expect.objectContaining({ id: JOB_ID, project_id: PROJECT_ID, output_document_name: 'GDD' }));
    expect(body.job).not.toHaveProperty('input');
    expect(body.job).not.toHaveProperty('source_snapshots');
    expect(body.job).not.toHaveProperty('idempotency_key');
    expect(body.job).not.toHaveProperty('input_hash');
    expect(body.job).not.toHaveProperty('lease_owner');
  });

  it('opportunistically wakes a queued job while it is being polled', async () => {
    getPublicGddGenerationJob.mockResolvedValue({ ...publicJob, status: 'queued', phase: 'collecting' });

    const response = await GET(new NextRequest(`https://example.test/api/projects/${PROJECT_ID}/gdd-generation-jobs/${JOB_ID}`), params);
    await Promise.resolve();

    expect(response.status).toBe(200);
    expect(processNextGddJob).toHaveBeenCalledWith(expect.objectContaining({
      serviceClient: { service: true },
      workerId: expect.stringMatching(/^gdd-poll-/),
    }));
  });

  it('lets an editor cancel an active project GDD job', async () => {
    getPublicGddGenerationJob.mockResolvedValue({ ...publicJob, status: 'queued', phase: 'collecting' });
    const serviceClient = { service: true };
    getSupabaseServiceRoleClient.mockReturnValue(serviceClient);

    const response = await DELETE(new NextRequest(`https://example.test/api/projects/${PROJECT_ID}/gdd-generation-jobs/${JOB_ID}`, {
      method: 'DELETE',
    }), params);

    expect(response.status).toBe(200);
    expect(cancelGddGenerationJob).toHaveBeenCalledWith(serviceClient, JOB_ID);
    expect(await response.json()).toEqual({ job: expect.objectContaining({ status: 'failed', phase: 'failed' }) });
  });

  it('returns a safe migration-required 503 when GET cannot see the jobs relation', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    getPublicGddGenerationJob.mockRejectedValue({ code: 'PGRST205', message: 'private schema detail' });

    const response = await GET(new NextRequest(`https://example.test/api/projects/${PROJECT_ID}/gdd-generation-jobs/${JOB_ID}`), params);

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'GDD generation database migration is not applied.' });
    expect(consoleError).toHaveBeenCalledWith('[GET project GDD generation job]', {
      name: 'DatabaseSchemaUnavailable', code: 'PGRST205',
    });
    consoleError.mockRestore();
  });

  it('GET uses the public column selector instead of the internal job reader', async () => {
    await GET(new NextRequest(`https://example.test/api/projects/${PROJECT_ID}/gdd-generation-jobs/${JOB_ID}`), params);

    expect(getPublicGddGenerationJob).toHaveBeenCalled();
    expect(getGddGenerationJob).not.toHaveBeenCalled();
  });

  it('returns the same public DTO from POST', async () => {
    const response = await POST(new NextRequest(`https://example.test/api/projects/${PROJECT_ID}/gdd-generation-jobs`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'request-key-1' },
      body: JSON.stringify({
        designSystemId: SYSTEM_ID,
        versionId: VERSION_ID,
        creativeBrief: 'Generate a new GDD with a map description',
      }),
    }), { params: Promise.resolve({ projectId: PROJECT_ID }) });
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(createGddGenerationJob).toHaveBeenCalledWith(
      { service: true },
      expect.objectContaining({
        input: expect.objectContaining({
          creativeBrief: 'Generate a new GDD with a map description',
          projectSources: [],
        }),
      }),
    );
    expect(body.job).not.toHaveProperty('input');
    expect(body.job).not.toHaveProperty('source_snapshots');
    expect(body.job).not.toHaveProperty('idempotency_key');
    expect(body.job).not.toHaveProperty('lease_owner');
  });

  it('returns the existing bounded job when another project generation is active', async () => {
    createGddGenerationJob.mockRejectedValue(new GddActiveJobConflictError({
      ...internalJob,
      status: 'running',
      phase: 'generating',
      maps: [],
    }));
    const response = await POST(new NextRequest(`https://example.test/api/projects/${PROJECT_ID}/gdd-generation-jobs`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'request-key-active' },
      body: JSON.stringify({ designSystemId: SYSTEM_ID, versionId: VERSION_ID }),
    }), { params: Promise.resolve({ projectId: PROJECT_ID }) });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual(expect.objectContaining({
      code: 'GDD_ACTIVE_JOB_EXISTS',
      job: expect.objectContaining({ id: JOB_ID, status: 'running' }),
    }));
    expect(body.job).not.toHaveProperty('input');
    expect(body.job).not.toHaveProperty('idempotency_key');
  });

  it.each(['42P01', 'PGRST205', 'PGRST202'])('returns a safe migration-required 503 for missing GDD database schema (%s)', async (code) => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    createGddGenerationJob.mockRejectedValue({
      code,
      message: 'internal SQL details and service credentials must stay private',
    });

    const response = await POST(new NextRequest(`https://example.test/api/projects/${PROJECT_ID}/gdd-generation-jobs`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'request-key-2' },
      body: JSON.stringify({ designSystemId: SYSTEM_ID, versionId: VERSION_ID }),
    }), { params: Promise.resolve({ projectId: PROJECT_ID }) });
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({ error: 'GDD generation database migration is not applied.' });
    expect(JSON.stringify(body)).not.toContain('internal SQL');
    expect(consoleError).toHaveBeenCalledWith('[POST project GDD generation job]', {
      name: 'DatabaseSchemaUnavailable', code,
    });
    consoleError.mockRestore();
  });
});
