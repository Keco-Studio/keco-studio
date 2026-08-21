import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('server-only', () => ({}));
jest.mock('next/server', () => {
  const actual = jest.requireActual<typeof import('next/server')>('next/server');
  return { ...actual, after: (callback: () => Promise<void>) => { void callback(); } };
});

const listPage = jest.fn();
const getDetail = jest.fn();
const getJob = jest.fn();
const createJob = jest.fn();
const publicJob = jest.fn((job: Record<string, unknown>) => ({
  id: job.id,
  status: job.status,
  phase: job.phase,
  error: job.status === 'failed'
    ? { code: 'GDS_GENERATION_FAILED', message: 'Game Design System generation failed.' }
    : null,
}));
const resolveSnapshots = jest.fn(async () => []);
const getUserProjectRole = jest.fn(async () => ({ isOwner: true, role: 'admin' }));
let versionResult: { data: Record<string, unknown> | null; error: unknown } = { data: null, error: null };
const authSupabase = {
  from: jest.fn(() => ({
    select: () => ({
      eq: () => ({ single: async () => versionResult }),
    }),
  })),
};
const withAuth = jest.fn((handler: Function) => (
  request: NextRequest,
  context?: unknown,
  ) => handler(request, context, {
    supabase: authSupabase,
  user: { id: '11111111-1111-4111-8111-111111111111' },
}));

jest.mock('@/lib/auth/route-auth', () => ({
  withAuth: (...args: unknown[]) => withAuth(...args),
}));
jest.mock('@/lib/services/gameDesignSystemService', () => ({
  IdempotencyConflictError: class IdempotencyConflictError extends Error {},
  createGameDesignSystem: jest.fn(),
  createGameDesignSystemGenerationJob: (...args: unknown[]) => createJob(...args),
  listGameDesignSystems: jest.fn(),
  listGameDesignSystemsPage: (...args: unknown[]) => listPage(...args),
  getGameDesignSystemDetail: (...args: unknown[]) => getDetail(...args),
  getGameDesignSystemGenerationJob: (...args: unknown[]) => getJob(...args),
  publicGameDesignSystemGenerationJob: (...args: unknown[]) => publicJob(...args),
  clearProjectGameDesignSystem: jest.fn(),
  getProjectGameDesignSystem: jest.fn(),
  setProjectGameDesignSystem: jest.fn(),
}));
jest.mock('@/lib/game-design-system/sourceSnapshots', () => ({
  SourceSnapshotInputError: class SourceSnapshotInputError extends Error {},
  resolveGameDesignSourceSnapshots: (...args: unknown[]) => resolveSnapshots(...args),
}));
jest.mock('@/lib/services/authorizationService', () => ({
  AuthorizationError: class AuthorizationError extends Error {},
  getUserProjectRole: (...args: unknown[]) => getUserProjectRole(...args),
  verifyProjectAccess: jest.fn(),
}));
jest.mock('@/lib/game-design-system/sourceVisibility.server', () => ({
  redactGameDesignSystemDetailForViewer: jest.fn((_: unknown, value: unknown) => value),
}));
jest.mock('@/lib/server/supabaseServiceRole', () => ({
  getSupabaseServiceRoleClient: jest.fn(() => ({})),
}));
jest.mock('@/lib/game-design-system/worker', () => ({
  shouldWakeGameDesignSystemGenerationJob: jest.fn(() => false),
  processNextGameDesignSystemJob: jest.fn(),
}));

import { GET as listSystems } from '@/app/api/game-design-systems/route';
import { GET as readSystem } from '@/app/api/game-design-systems/[id]/route';
import { GET as readJob } from '@/app/api/game-design-systems/generation-jobs/[id]/route';
import { POST as createGeneration } from '@/app/api/game-design-systems/generation-jobs/route';
import { POST as retryGeneration } from '@/app/api/game-design-systems/generation-jobs/[id]/retry/route';
import { PUT as setProjectSystem } from '@/app/api/projects/[projectId]/game-design-system/route';
import { IdempotencyConflictError } from '@/lib/services/gameDesignSystemService';

const BASE_ID = '22222222-2222-4222-8222-222222222222';
const PROJECT_ID = '33333333-3333-4333-8333-333333333333';
const VERSION_ID = '44444444-4444-4444-8444-444444444444';
const IDEMPOTENCY_KEY = 'route-test-key';
const ART_STYLE = {
  presetId: 'pixel-art',
  presetVersion: 2,
  customization: { referenceGames: [] },
};

function generationRequest(overrides: Record<string, unknown> = {}) {
  return new NextRequest('https://keco.test/api/game-design-systems/generation-jobs', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': IDEMPOTENCY_KEY },
    body: JSON.stringify({
      title: 'Tactical rules',
      genres: ['Strategy'],
      philosophies: [],
      references: [],
      referenceGames: [],
      artStyle: ART_STYLE,
      ...overrides,
    }),
  });
}

describe('GDS App API MCP boundary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    versionResult = { data: null, error: null };
  });

  it('passes bounded list pagination to the database service', async () => {
    listPage.mockResolvedValue({ systems: [], hasMore: false, nextOffset: null });
    const response = await listSystems(new NextRequest(
      'https://keco.test/api/game-design-systems?limit=51&offset=100',
    ), undefined);

    expect(response.status).toBe(200);
    expect(listPage).toHaveBeenCalledWith(authSupabase, { limit: 51, offset: 100 });
    await expect(response.json()).resolves.toEqual({
      systems: [],
      hasMore: false,
      nextOffset: null,
    });
  });

  it('returns GDS_NOT_FOUND for a missing system', async () => {
    getDetail.mockResolvedValue(null);
    const response = await readSystem(
      new NextRequest('https://keco.test/api/game-design-systems/missing?versionLimit=50'),
      { params: Promise.resolve({ id: 'missing' }) },
    );
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ code: 'GDS_NOT_FOUND' });
    expect(getDetail).toHaveBeenCalledWith(authSupabase, 'missing', expect.objectContaining({
      versionLimit: 50,
    }));
  });

  it('returns GDS_NOT_FOUND without stored diagnostics for a missing job', async () => {
    getJob.mockResolvedValue(null);
    const response = await readJob(
      new NextRequest('https://keco.test/api/game-design-systems/generation-jobs/missing'),
      { params: Promise.resolve({ id: 'missing' }) },
    );
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: 'Generation job not found.',
      code: 'GDS_NOT_FOUND',
    });
  });

  it('redacts stored diagnostics from generation GET responses', async () => {
    getJob.mockResolvedValue({
      id: 'job-1', status: 'failed', phase: 'failed',
      error: 'SQL failed at private_table with provider token secret',
    });
    const response = await readJob(
      new NextRequest('https://keco.test/api/game-design-systems/generation-jobs/job-1'),
      { params: Promise.resolve({ id: 'job-1' }) },
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.job.error).toEqual({
      code: 'GDS_GENERATION_FAILED',
      message: 'Game Design System generation failed.',
    });
    expect(JSON.stringify(payload)).not.toMatch(/private_table|provider token|secret/i);
    expect(publicJob).toHaveBeenCalled();
  });

  it('redacts stored diagnostics from generation POST responses', async () => {
    createJob.mockResolvedValue({
      id: 'job-1', status: 'failed', phase: 'failed',
      error: 'provider returned private diagnostic',
    });
    const response = await createGeneration(generationRequest(), undefined);

    expect(response.status).toBe(202);
    const payload = await response.json();
    expect(payload.job.error).toMatchObject({ code: 'GDS_GENERATION_FAILED' });
    expect(JSON.stringify(payload)).not.toContain('private diagnostic');
    expect(publicJob).toHaveBeenCalled();
  });

  it('returns stable codes for a missing base and an idempotency conflict', async () => {
    getDetail.mockResolvedValue(null);
    const missing = await createGeneration(generationRequest({ baseSystemId: BASE_ID }), undefined);
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toMatchObject({ code: 'GDS_NOT_FOUND' });

    createJob.mockRejectedValue(new IdempotencyConflictError());
    const conflict = await createGeneration(generationRequest(), undefined);
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('returns stable retry codes and redacts a retried failed job', async () => {
    getJob.mockResolvedValueOnce(null);
    const missing = await retryGeneration(
      new NextRequest('https://keco.test/retry', { method: 'POST', headers: { 'idempotency-key': IDEMPOTENCY_KEY } }),
      { params: Promise.resolve({ id: 'missing' }) },
    );
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toMatchObject({ code: 'GDS_NOT_FOUND' });

    getJob.mockResolvedValueOnce({ id: 'job-running', status: 'running' });
    const active = await retryGeneration(
      new NextRequest('https://keco.test/retry', { method: 'POST', headers: { 'idempotency-key': IDEMPOTENCY_KEY } }),
      { params: Promise.resolve({ id: 'job-running' }) },
    );
    expect(active.status).toBe(409);
    await expect(active.json()).resolves.toMatchObject({ code: 'GDS_JOB_CONFLICT' });

    getJob.mockResolvedValueOnce({ id: 'job-failed', status: 'failed', input: {} });
    createJob.mockResolvedValueOnce({
      id: 'job-retry', status: 'failed', phase: 'failed', error: 'raw retry SQL error',
    });
    const retried = await retryGeneration(
      new NextRequest('https://keco.test/retry', { method: 'POST', headers: { 'idempotency-key': IDEMPOTENCY_KEY } }),
      { params: Promise.resolve({ id: 'job-failed' }) },
    );
    const retriedPayload = await retried.json();
    expect(retriedPayload.job.error).toMatchObject({ code: 'GDS_GENERATION_FAILED' });
    expect(JSON.stringify(retriedPayload)).not.toContain('raw retry SQL error');
  });

  it('returns stable codes for missing and conflicted project-bound versions', async () => {
    versionResult = { data: null, error: { code: 'PGRST116' } };
    const missing = await setProjectSystem(new NextRequest('https://keco.test/project-gds', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ designSystemId: BASE_ID, versionId: VERSION_ID }),
    }), { params: Promise.resolve({ projectId: PROJECT_ID }) });
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toMatchObject({ code: 'GDS_NOT_FOUND' });

    versionResult = { data: { id: VERSION_ID, system_id: BASE_ID, conflicts: [{ id: 'c1' }] }, error: null };
    const conflict = await setProjectSystem(new NextRequest('https://keco.test/project-gds', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ designSystemId: BASE_ID, versionId: VERSION_ID }),
    }), { params: Promise.resolve({ projectId: PROJECT_ID }) });
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({ code: 'GDS_JOB_CONFLICT' });
  });
});
