import { NextRequest } from 'next/server';

const readCreateMapDocumentSource = jest.fn();
const createMapPlanV2 = jest.fn();
let authenticated = true;
const supabase = {};

class MockAuthorizationError extends Error {}
class MockDocumentSourceError extends Error {
  constructor(readonly code: string) { super(code); }
}
class MockPlannerError extends Error { code = 'map_plan_invalid_response'; }
class MockPlannerInputError extends Error { code = 'map_description_required'; }

const withAuth = jest.fn((handler: unknown, options: { unauthorizedResponse?: () => Response } = {}) =>
  async (request: NextRequest) => {
    if (!authenticated) return options.unauthorizedResponse?.() ?? Response.json({}, { status: 401 });
    return (handler as Function)(request, undefined, { supabase, user: { id: 'user-1' } });
  });

jest.mock('@/lib/auth/route-auth', () => ({ withAuth: (...args: unknown[]) => withAuth(...args) }));
jest.mock('@/lib/services/authorizationService', () => ({ AuthorizationError: MockAuthorizationError }));
jest.mock('@/lib/server/createMapDocumentSource', () => ({
  CreateMapDocumentSourceError: MockDocumentSourceError,
  readCreateMapDocumentSource: (...args: unknown[]) => readCreateMapDocumentSource(...args),
}));
jest.mock('@/lib/server/createMapPlanner', () => ({
  CreateMapPlannerError: MockPlannerError,
  CreateMapPlannerInputError: MockPlannerInputError,
  createMapPlanV2: (...args: unknown[]) => createMapPlanV2(...args),
}));

import { POST } from '@/app/api/create-map/plan/route';
import { makeValidMapPlanV2 } from './fixtures';

const projectId = '22222222-2222-4222-8222-222222222222';
const documentId = '11111111-1111-4111-8111-111111111111';
const description = 'A compact riverside village market';
const source = {
  documentId, projectId, documentName: 'Village', documentUpdatedAt: '2026-08-08T08:00:00.000Z',
  markdown: '# Village private markdown', token: { epoch: 2, revision: 7 },
};

function post(body: unknown) {
  return POST(new NextRequest('https://example.test/api/create-map/plan', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }), undefined);
}

describe('POST /api/create-map/plan', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    authenticated = true;
    readCreateMapDocumentSource.mockResolvedValue(source);
    createMapPlanV2.mockResolvedValue(makeValidMapPlanV2());
  });

  it('requires authentication and a non-empty description', async () => {
    authenticated = false;
    expect((await post({ description })).status).toBe(401);
    authenticated = true;
    expect((await post({ description: '   ' })).status).toBe(400);
    expect(createMapPlanV2).not.toHaveBeenCalled();
  });

  it('creates a description-only plan without reading Document state', async () => {
    const response = await post({ description });

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    await expect(response.json()).resolves.toEqual({ plan: makeValidMapPlanV2(), sourceToken: null });
    expect(readCreateMapDocumentSource).not.toHaveBeenCalled();
    expect(createMapPlanV2).toHaveBeenCalledWith(description, undefined);
  });

  it('requires projectId with documentId', async () => {
    expect((await post({ description, documentId })).status).toBe(400);
    expect(readCreateMapDocumentSource).not.toHaveBeenCalled();
  });

  it('uses authorized optional Document context without echoing markdown', async () => {
    const response = await post({ description, projectId, documentId });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(readCreateMapDocumentSource).toHaveBeenCalledWith(supabase, 'user-1', projectId, documentId);
    expect(createMapPlanV2).toHaveBeenCalledWith(description, source);
    expect(payload.sourceToken).toEqual({
      documentId,
      documentUpdatedAt: source.documentUpdatedAt,
      epoch: 2,
      revision: 7,
    });
    expect(JSON.stringify(payload)).not.toContain(source.markdown);
  });

  it('rejects viewers and cross-project Documents before planning', async () => {
    readCreateMapDocumentSource.mockRejectedValueOnce(new MockAuthorizationError());
    expect((await post({ description, projectId, documentId })).status).toBe(403);

    readCreateMapDocumentSource.mockRejectedValueOnce(new MockDocumentSourceError('document_project_mismatch'));
    expect((await post({ description, projectId, documentId })).status).toBe(403);
    expect(createMapPlanV2).not.toHaveBeenCalled();
  });
});
