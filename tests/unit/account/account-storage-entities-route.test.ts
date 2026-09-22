import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const ENTITY_ID = '22222222-2222-4222-8222-222222222222';
let authenticated = true;
const supabase = { rpc: jest.fn() };
const withAuth = jest.fn((handler: unknown, options: { unauthorizedResponse?: () => Response } = {}) =>
  async (request: NextRequest, context: unknown) => {
    if (!authenticated) return options.unauthorizedResponse?.() ?? Response.json({}, { status: 401 });
    return (handler as Function)(request, context, { supabase, user: { id: ENTITY_ID } });
  });
const readProjectStorageEntities = jest.fn();
const readProjectStorageEntityDetail = jest.fn();

jest.mock('server-only', () => ({}));
jest.mock('@/lib/auth/route-auth', () => ({ withAuth: (...args: unknown[]) => withAuth(...args) }));
jest.mock('@/lib/server/accountStorage', () => ({ readProjectStorageEntities, readProjectStorageEntityDetail }));

import { GET as getEntitiesRoute } from '@/app/api/account/storage/projects/[projectId]/entities/route';
import { GET as getDetailRoute } from '@/app/api/account/storage/projects/[projectId]/entities/[kind]/[entityId]/route';

const page = { items: [], total: 0, limit: 50, offset: 0 };
const detail = {
  id: ENTITY_ID,
  kind: 'table',
  name: 'Characters',
  logicalBytes: 1,
  physicalBytes: 2,
  sizeBytes: 3,
  sourceAvailable: true,
  items: [],
};

function getEntities(query = '', projectId = PROJECT_ID) {
  return getEntitiesRoute(
    new NextRequest(`https://example.test/api/account/storage/projects/${projectId}/entities?${query}`),
    { params: Promise.resolve({ projectId }) },
  );
}

function getDetail(kind = 'table', entityId = ENTITY_ID, projectId = PROJECT_ID) {
  return getDetailRoute(
    new NextRequest(`https://example.test/api/account/storage/projects/${projectId}/entities/${kind}/${entityId}`),
    { params: Promise.resolve({ projectId, kind: kind as 'table', entityId }) },
  );
}

describe('Account storage entity routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    authenticated = true;
    readProjectStorageEntities.mockResolvedValue(page);
    readProjectStorageEntityDetail.mockResolvedValue(detail);
  });

  it('returns a private aggregate page with validated query parameters', async () => {
    const response = await getEntities('query=char&sort=name_asc&limit=10&offset=20');
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    await expect(response.json()).resolves.toEqual(page);
    expect(readProjectStorageEntities).toHaveBeenCalledWith(supabase, {
      projectId: PROJECT_ID,
      query: 'char',
      sort: 'name_asc',
      limit: 10,
      offset: 20,
    });
  });

  it.each([
    ['not-a-uuid', ''],
    [PROJECT_ID, 'sort=raw_files'],
    [PROJECT_ID, 'limit=0'],
    [PROJECT_ID, 'unexpected=value'],
  ])('rejects an invalid aggregate request', async (projectId, query) => {
    const response = await getEntities(query, projectId);
    expect(response.status).toBe(400);
    expect(readProjectStorageEntities).not.toHaveBeenCalled();
  });

  it('returns private entity details and validates all path segments', async () => {
    const response = await getDetail();
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    await expect(response.json()).resolves.toEqual(detail);
    expect(readProjectStorageEntityDetail).toHaveBeenCalledWith(supabase, {
      projectId: PROJECT_ID,
      kind: 'table',
      entityId: ENTITY_ID,
    });

    expect((await getDetail('media')).status).toBe(400);
    expect((await getDetail('table', 'not-a-uuid')).status).toBe(400);
  });

  it('maps authorization, missing entities, service failure, and authentication', async () => {
    readProjectStorageEntities.mockRejectedValueOnce({ code: 'STORAGE_PROJECT_FORBIDDEN' });
    expect((await getEntities()).status).toBe(403);

    readProjectStorageEntityDetail.mockRejectedValueOnce({ code: 'STORAGE_ENTITY_NOT_FOUND' });
    expect((await getDetail()).status).toBe(404);

    readProjectStorageEntityDetail.mockRejectedValueOnce(new Error('private database detail'));
    const failed = await getDetail();
    expect(failed.status).toBe(503);
    await expect(failed.json()).resolves.toEqual({ error: 'Unable to load storage entity details' });

    authenticated = false;
    expect((await getEntities()).status).toBe(401);
  });
});
