import { NextRequest } from 'next/server';

const getUserProjectRole = jest.fn();
const getResourceJob = jest.fn();
const retryResourceJob = jest.fn();
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
jest.mock('@/lib/services/authorizationService', () => ({
  getUserProjectRole: (...args: unknown[]) => getUserProjectRole(...args),
}));
jest.mock('@/lib/services/gddGenerationService', () => ({
  getGddResourceJob: (...args: unknown[]) => getResourceJob(...args),
  retryFailedGddResourceJob: (...args: unknown[]) => retryResourceJob(...args),
}));
jest.mock('@/lib/server/supabaseServiceRole', () => ({ getSupabaseServiceRoleClient: () => serviceClient }));
jest.mock('@/lib/gdd-generation/resources/worker', () => ({
  processNextGddResourceJob: (...args: unknown[]) => processNext(...args),
}));

import { POST } from '@/app/api/projects/[projectId]/gdd-generation-jobs/[id]/resources/[resourceJobId]/retry/route';

const params = {
  params: Promise.resolve({ projectId: 'project-1', id: 'gdd-1', resourceJobId: 'resource-1' }),
};
const failedResource = {
  id: 'resource-1', gdd_generation_job_id: 'gdd-1', project_id: 'project-1', document_id: 'document-1',
  kind: 'maps', payload: { private: true }, status: 'failed', attempt_count: 3, max_attempts: 3,
  available_at: '2026-09-15T14:52:34.000Z', lease_owner: null, lease_expires_at: null,
  error: 'Map writeback failed [PT409]', completed_at: '2026-09-15T14:52:42.000Z',
};

describe('GDD resource retry route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    userId = 'user-1';
    getUserProjectRole.mockResolvedValue({ role: 'editor' });
    getResourceJob.mockResolvedValue(failedResource);
    retryResourceJob.mockResolvedValue({
      ...failedResource, status: 'queued', attempt_count: 0, error: null, completed_at: null,
    });
    processNext.mockResolvedValue({ claimed: true, jobId: 'resource-1', status: 'completed' });
  });

  it('requeues one project-scoped failed resource and schedules its worker', async () => {
    const response = await POST(new NextRequest('https://example.test/retry', { method: 'POST' }), params);
    await Promise.resolve();

    expect(response.status).toBe(202);
    expect(getResourceJob).toHaveBeenCalledWith(serviceClient, {
      projectId: 'project-1', jobId: 'gdd-1', resourceJobId: 'resource-1',
    });
    expect(retryResourceJob).toHaveBeenCalledWith(serviceClient, 'resource-1');
    expect(processNext).toHaveBeenCalled();
    expect(await response.json()).toEqual({
      resource: expect.objectContaining({ id: 'resource-1', kind: 'maps', status: 'queued', attempt_count: 0 }),
    });
  });

  it('rejects viewers before reading private resource state', async () => {
    getUserProjectRole.mockResolvedValue({ role: 'viewer' });
    const response = await POST(new NextRequest('https://example.test/retry', { method: 'POST' }), params);
    expect(response.status).toBe(403);
    expect(getResourceJob).not.toHaveBeenCalled();
  });

  it('does not retry missing, cross-project, or non-failed resources', async () => {
    getResourceJob.mockResolvedValueOnce(null);
    expect((await POST(new NextRequest('https://example.test/retry', { method: 'POST' }), params)).status).toBe(404);

    getResourceJob.mockResolvedValueOnce({ ...failedResource, status: 'completed' });
    expect((await POST(new NextRequest('https://example.test/retry', { method: 'POST' }), params)).status).toBe(409);
    expect(retryResourceJob).not.toHaveBeenCalled();
  });
});
