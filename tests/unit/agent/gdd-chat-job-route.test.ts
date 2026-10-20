jest.mock('server-only', () => ({}));
jest.mock('@/lib/auth/route-auth', () => ({ withAuth: (handler: (...args: unknown[]) => unknown) => handler }));
jest.mock('@/lib/agent/game-design-system-tool-service', () => ({ generationStatus: jest.fn(), DesignToolError: class DesignToolError extends Error {} }));

import { NextRequest } from 'next/server';
import { GET } from '@/app/api/agent-chat/gdd-jobs/[id]/route';
import { DesignToolError, generationStatus } from '@/lib/agent/game-design-system-tool-service';

const jobId = '10000000-0000-4000-8000-000000000005';
beforeEach(() => jest.clearAllMocks());

it('uses the owned GDD status reader and returns only its bounded result', async () => {
  jest.mocked(generationStatus).mockResolvedValueOnce({ jobType: 'gdd', jobId, status: 'queued', phase: 'collecting' });
  const supabase = {} as never;
  const response = await GET(new NextRequest(`http://localhost/api/agent-chat/gdd-jobs/${jobId}`),
    { params: Promise.resolve({ id: jobId }) }, { supabase, user: { id: 'user-1' } } as never);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ job: { jobType: 'gdd', jobId, status: 'queued', phase: 'collecting' } });
  expect(generationStatus).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1', supabase }), { jobType: 'gdd', jobId });
});

it('rejects malformed IDs before reading status', async () => {
  const response = await GET(new NextRequest('http://localhost/api/agent-chat/gdd-jobs/bad'),
    { params: Promise.resolve({ id: 'bad' }) }, { supabase: {} as never, user: { id: 'user-1' } } as never);
  expect(response.status).toBe(400);
  expect(generationStatus).not.toHaveBeenCalled();
});

it('does not reveal a job after access is revoked', async () => {
  jest.mocked(generationStatus).mockRejectedValueOnce(new DesignToolError('private database or provider detail'));
  const response = await GET(new NextRequest(`http://localhost/api/agent-chat/gdd-jobs/${jobId}`),
    { params: Promise.resolve({ id: jobId }) }, { supabase: {} as never, user: { id: 'user-1' } } as never);
  expect(response.status).toBe(404);
  expect(JSON.stringify(await response.json())).not.toContain('private database');
});

it('marks a transient status failure as retryable without exposing internals', async () => {
  jest.mocked(generationStatus).mockRejectedValueOnce(new Error('private database or provider detail'));
  const response = await GET(new NextRequest(`http://localhost/api/agent-chat/gdd-jobs/${jobId}`),
    { params: Promise.resolve({ id: jobId }) }, { supabase: {} as never, user: { id: 'user-1' } } as never);
  expect(response.status).toBe(503);
  expect(JSON.stringify(await response.json())).not.toContain('private database');
});
