import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
let authenticated = true;
const supabase = { rpc: jest.fn() };
const withAuth = jest.fn((handler: unknown, options: { unauthorizedResponse?: () => Response } = {}) =>
  async (request: NextRequest, context: unknown) => {
    if (!authenticated) return options.unauthorizedResponse?.() ?? Response.json({}, { status: 401 });
    return (handler as Function)(request, context, {
      supabase,
      user: { id: '10000000-0000-4000-8000-000000000001' },
    });
  });
const readProjectStorageFiles = jest.fn();

jest.mock('server-only', () => ({}));
jest.mock('@/lib/auth/route-auth', () => ({
  withAuth: (...args: unknown[]) => withAuth(...args),
}));
jest.mock('@/lib/server/accountStorage', () => ({ readProjectStorageFiles }));

import { GET } from '@/app/api/account/storage/projects/[projectId]/files/route';

const validPage = {
  items: [],
  total: 0,
  limit: 50,
  offset: 0,
};

function getFiles(query = '', projectId = PROJECT_ID) {
  return GET(
    new NextRequest(`https://example.test/api/account/storage/projects/${projectId}/files?${query}`),
    { params: Promise.resolve({ projectId }) },
  );
}

describe('GET /api/account/storage/projects/:projectId/files', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    authenticated = true;
    readProjectStorageFiles.mockResolvedValue(validPage);
  });

  it('returns validated project files privately', async () => {
    const response = await getFiles('query=dragon&sort=created_desc&limit=10&offset=20');

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    await expect(response.json()).resolves.toEqual(validPage);
    expect(readProjectStorageFiles).toHaveBeenCalledWith(supabase, {
      projectId: PROJECT_ID,
      query: 'dragon',
      sort: 'created_desc',
      limit: 10,
      offset: 20,
    });
  });

  it('requires authentication with a private response', async () => {
    authenticated = false;

    const response = await getFiles();

    expect(response.status).toBe(401);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it.each([
    ['project id is not a UUID', '', 'not-a-uuid'],
    ['sort is unknown', 'sort=unknown', PROJECT_ID],
    ['limit is zero', 'limit=0', PROJECT_ID],
    ['limit is fractional', 'limit=1.5', PROJECT_ID],
    ['offset is negative', 'offset=-1', PROJECT_ID],
    ['query is longer than 200 characters', `query=${'x'.repeat(201)}`, PROJECT_ID],
    ['an unknown parameter is supplied', 'unexpected=value', PROJECT_ID],
  ])('returns 400 when %s', async (_reason, query, projectId) => {
    const response = await getFiles(query, projectId);

    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(readProjectStorageFiles).not.toHaveBeenCalled();
  });

  it('maps an inaccessible project to a private 403 response', async () => {
    readProjectStorageFiles.mockRejectedValue({ code: 'STORAGE_PROJECT_FORBIDDEN' });

    const response = await getFiles();

    expect(response.status).toBe(403);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' });
  });

  it('maps service failures to a generic private 503 response', async () => {
    readProjectStorageFiles.mockRejectedValue(new Error('database failure'));

    const response = await getFiles();

    expect(response.status).toBe(503);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    await expect(response.json()).resolves.toEqual({ error: 'Unable to load project files' });
  });
});
