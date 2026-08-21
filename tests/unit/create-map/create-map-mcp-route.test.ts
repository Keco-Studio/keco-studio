import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const service = {
  listMaps: jest.fn(),
  readMap: jest.fn(),
  createDraft: jest.fn(),
  updateDraft: jest.fn(),
  prepareGeneration: jest.fn(),
  startGeneration: jest.fn(),
  getGeneration: jest.fn(),
  retryGeneration: jest.fn(),
};
let authenticated = true;
const supabase = {};
const withAuth = jest.fn((handler: unknown, options: { unauthorizedResponse?: () => Response } = {}) =>
  async (request: NextRequest) => {
    if (!authenticated) return options.unauthorizedResponse?.() ?? Response.json({}, { status: 401 });
    return (handler as Function)(request, undefined, {
      supabase,
      user: { id: '10000000-0000-4000-8000-000000000001' },
    });
  });

jest.mock('@/lib/auth/route-auth', () => ({
  withAuth: (...args: unknown[]) => withAuth(...args),
}));
jest.mock('@/lib/server/createMapMcpService', () => {
  class MockCreateMapMcpError extends Error {
    constructor(readonly code: string, message = code) {
      super(message);
    }
  }
  return {
    CreateMapMcpError: MockCreateMapMcpError,
    createMapMcpPublicMessage: (code: string) => `Public ${code}`,
    createMapMcpService: jest.fn(() => service),
  };
});

import { POST } from '@/app/api/mcp/create-map/route';
import { CreateMapMcpError } from '@/lib/server/createMapMcpService';

const IDS = {
  projectId: '10000000-0000-4000-8000-000000000002',
  mapId: '10000000-0000-4000-8000-000000000003',
  revisionId: '10000000-0000-4000-8000-000000000004',
  assetId: '10000000-0000-4000-8000-000000000005',
  generationId: '10000000-0000-4000-8000-000000000006',
};

function post(body: unknown) {
  return POST(new NextRequest('https://example.test/api/mcp/create-map', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }), undefined);
}

describe('POST /api/mcp/create-map', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    authenticated = true;
    service.listMaps.mockResolvedValue({ items: [], returnedCount: 0 });
    service.startGeneration.mockResolvedValue({ assetId: IDS.assetId, status: 'generating' });
  });

  it('requires authentication and always returns private no-store responses', async () => {
    authenticated = false;
    const unauthorized = await post({ action: 'list_maps', projectId: IDS.projectId });
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get('Cache-Control')).toBe('private, no-store');

    authenticated = true;
    const response = await post({ action: 'list_maps', projectId: IDS.projectId });
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    await expect(response.json()).resolves.toEqual({ items: [], returnedCount: 0 });
    expect(service.listMaps).toHaveBeenCalledWith({ projectId: IDS.projectId });
  });

  it('rejects unknown actions, unknown fields, and false paid confirmation', async () => {
    expect((await post({ action: 'delete_map', projectId: IDS.projectId })).status).toBe(400);
    expect((await post({
      action: 'list_maps',
      projectId: IDS.projectId,
      actorUserId: 'forged',
    })).status).toBe(400);
    expect((await post({
      action: 'start_map_generation',
      projectId: IDS.projectId,
      mapId: IDS.mapId,
      revisionId: IDS.revisionId,
      assetId: IDS.assetId,
      generationId: IDS.generationId,
      planFingerprint: 'a'.repeat(64),
      confirmationToken: 'confirmation-token',
      confirmPaidGeneration: false,
    })).status).toBe(400);
    expect(service.startGeneration).not.toHaveBeenCalled();
  });

  it('dispatches a literal paid confirmation without actor or provider inputs', async () => {
    const input = {
      projectId: IDS.projectId,
      mapId: IDS.mapId,
      revisionId: IDS.revisionId,
      assetId: IDS.assetId,
      generationId: IDS.generationId,
      planFingerprint: 'a'.repeat(64),
      confirmationToken: 'confirmation-token',
      confirmPaidGeneration: true,
    };
    const response = await post({ action: 'start_map_generation', ...input });
    expect(response.status).toBe(200);
    expect(service.startGeneration).toHaveBeenCalledWith(input);
  });

  it.each([
    ['PROJECT_WRITE_FORBIDDEN', 403],
    ['MAP_NOT_FOUND', 404],
    ['MAP_REVISION_STALE', 409],
    ['IDEMPOTENCY_CONFLICT', 409],
    ['MAP_CONFIRMATION_REQUIRED', 409],
    ['MAP_CONFIRMATION_EXPIRED', 409],
    ['MAP_CONFIRMATION_MISMATCH', 409],
    ['PROVIDER_RATE_LIMITED', 429],
    ['PROVIDER_QUOTA_EXCEEDED', 429],
    ['UPSTREAM_UNAVAILABLE', 503],
  ])('maps %s to a stable HTTP response', async (code, status) => {
    service.listMaps.mockRejectedValueOnce(new CreateMapMcpError(code as never));
    const response = await post({ action: 'list_maps', projectId: IDS.projectId });
    expect(response.status).toBe(status);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    await expect(response.json()).resolves.toMatchObject({ code, error: expect.any(String) });
  });

  it('never exposes a custom internal domain-error message', async () => {
    service.listMaps.mockRejectedValueOnce(
      new CreateMapMcpError('MAP_NOT_FOUND', 'database maps.secret_column does not exist'),
    );

    const response = await post({ action: 'list_maps', projectId: IDS.projectId });

    await expect(response.json()).resolves.toEqual({
      code: 'MAP_NOT_FOUND',
      error: 'Public MAP_NOT_FOUND',
    });
  });
});
