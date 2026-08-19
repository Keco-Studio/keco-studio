import { NextRequest } from 'next/server';

const getUserProjectRole = jest.fn();
const listJobs = jest.fn();
const findWakeableJob = jest.fn();
const getGddJob = jest.fn();
const getJob = jest.fn();
const retryJob = jest.fn();
const processNext = jest.fn();
let userId: string | null = 'user-1';
const serviceClient = { service: true };

jest.mock('next/server', () => {
  const actual = jest.requireActual('next/server') as Record<string, unknown>;
  return { ...actual, after: (callback: () => Promise<void>) => { void callback(); } };
});
jest.mock('server-only', () => ({}));
jest.mock('@/lib/auth/route-auth', () => ({
  withAuth: (handler: Function) => async (request: NextRequest, context: unknown) => {
    if (!userId) return Response.json({ error: 'Please sign in to continue' }, { status: 401 });
    return handler(request, context, { supabase: {}, user: { id: userId } });
  },
}));
jest.mock('@/lib/services/authorizationService', () => ({ getUserProjectRole: (...args: unknown[]) => getUserProjectRole(...args) }));
jest.mock('@/lib/services/dialogueGenerationService', () => ({
  listDialogueGenerationJobs: (...args: unknown[]) => listJobs(...args),
  findWakeableDialogueGenerationJob: (...args: unknown[]) => findWakeableJob(...args),
  getDialogueGenerationJob: (...args: unknown[]) => getJob(...args),
  retryDialogueGenerationJob: (...args: unknown[]) => retryJob(...args),
}));
jest.mock('@/lib/services/gddGenerationService', () => ({
  getGddGenerationJob: (...args: unknown[]) => getGddJob(...args),
}));
jest.mock('@/lib/server/supabaseServiceRole', () => ({ getSupabaseServiceRoleClient: () => serviceClient }));
jest.mock('@/lib/gdd-generation/dialogueWorker', () => ({
  processNextDialogueJob: (...args: unknown[]) => processNext(...args),
}));

import { GET } from '@/app/api/projects/[projectId]/gdd-generation-jobs/[id]/dialogue-jobs/route';
import { POST } from '@/app/api/projects/[projectId]/gdd-generation-jobs/[id]/dialogue-jobs/[dialogueJobId]/retry/route';

const params = { params: Promise.resolve({ projectId: 'project-1', id: 'gdd-1' }) };
const retryParams = { params: Promise.resolve({ projectId: 'project-1', id: 'gdd-1', dialogueJobId: 'dialogue-1' }) };
const failedJob = { id: 'dialogue-1', project_id: 'project-1', gdd_generation_job_id: 'gdd-1', status: 'failed' };

describe('dialogue generation routes', () => {
  beforeEach(() => {
    jest.clearAllMocks(); userId = 'user-1';
    getUserProjectRole.mockResolvedValue({ role: 'editor' });
    listJobs.mockResolvedValue([failedJob]);
    findWakeableJob.mockResolvedValue(null);
    getGddJob.mockResolvedValue({ id: 'gdd-1', project_id: 'project-1' });
    getJob.mockResolvedValue(failedJob);
    retryJob.mockResolvedValue({ ...failedJob, status: 'queued' });
    processNext.mockResolvedValue({ claimed: true, jobId: 'dialogue-1', status: 'completed' });
  });

  it('lists project-scoped dialogue jobs for editors', async () => {
    const response = await GET(new NextRequest('https://example.test/dialogue-jobs'), params);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ jobs: [failedJob] });
    expect(listJobs).toHaveBeenCalledWith(serviceClient, 'project-1', 'gdd-1');
  });

  it('returns 404 when the parent GDD job is missing or belongs to another project', async () => {
    getGddJob.mockResolvedValueOnce(null);
    expect((await GET(new NextRequest('https://example.test/dialogue-jobs'), params)).status).toBe(404);
    getGddJob.mockResolvedValueOnce({ id: 'gdd-1', project_id: 'project-2' });
    expect((await GET(new NextRequest('https://example.test/dialogue-jobs'), params)).status).toBe(404);
    expect(listJobs).not.toHaveBeenCalled();
  });

  it('schedules a stale running job using private lease state', async () => {
    findWakeableJob.mockResolvedValueOnce({ id: 'dialogue-stale', status: 'running' });
    const response = await GET(new NextRequest('https://example.test/dialogue-jobs'), params);
    await Promise.resolve();
    expect(response.status).toBe(200);
    expect(findWakeableJob).toHaveBeenCalledWith(serviceClient, 'project-1', 'gdd-1');
    expect(processNext).toHaveBeenCalled();
  });

  it('rejects viewers', async () => {
    getUserProjectRole.mockResolvedValue({ role: 'viewer' });
    expect((await GET(new NextRequest('https://example.test/dialogue-jobs'), params)).status).toBe(403);
  });

  it('requeues one failed chapter and schedules its worker', async () => {
    const response = await POST(new NextRequest('https://example.test/retry', { method: 'POST' }), retryParams);
    await Promise.resolve();
    expect(response.status).toBe(202);
    expect(retryJob).toHaveBeenCalledWith(serviceClient, 'dialogue-1', 'user-1');
    expect(processNext).toHaveBeenCalled();
  });

  it('does not retry completed jobs or cross-project IDs', async () => {
    getJob.mockResolvedValueOnce({ ...failedJob, status: 'completed' });
    expect((await POST(new NextRequest('https://example.test/retry', { method: 'POST' }), retryParams)).status).toBe(409);
    getJob.mockResolvedValueOnce(null);
    expect((await POST(new NextRequest('https://example.test/retry', { method: 'POST' }), retryParams)).status).toBe(404);
  });
});
