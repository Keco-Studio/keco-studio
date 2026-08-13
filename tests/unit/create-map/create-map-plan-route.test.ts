import { NextRequest } from 'next/server';

const readCreateMapDocumentSource = jest.fn();
const createMapPlanV3 = jest.fn();
let authenticated = true;
const referenceRows = jest.fn();
const referenceIn = jest.fn(() => referenceRows());
const referenceEq = jest.fn(() => ({ in: referenceIn }));
const referenceSelect = jest.fn(() => ({ eq: referenceEq }));
const supabase = { from: jest.fn(() => ({ select: referenceSelect })) };

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
  createMapPlanV3: (...args: unknown[]) => createMapPlanV3(...args),
}));

import { POST } from '@/app/api/create-map/plan/route';
import { makeValidMapPlanV3 } from './fixtures';

const projectId = '22222222-2222-4222-8222-222222222222';
const documentId = '11111111-1111-4111-8111-111111111111';
const description = 'A compact riverside village market';
const source = {
  documentId, projectId, documentName: 'Village', documentUpdatedAt: '2026-08-08T08:00:00.000Z',
  markdown: '# Village private markdown', token: { epoch: 2, revision: 7 },
};
const referenceId = '33333333-3333-4333-8333-333333333333';
const styleReferenceId = '44444444-4444-4444-8444-444444444444';

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
    createMapPlanV3.mockResolvedValue(makeValidMapPlanV3());
    referenceRows.mockResolvedValue({ data: [], error: null });
  });

  it('requires authentication and a non-empty description', async () => {
    authenticated = false;
    expect((await post({ description })).status).toBe(401);
    authenticated = true;
    expect((await post({ description: '   ' })).status).toBe(400);
    expect(createMapPlanV3).not.toHaveBeenCalled();
  });

  it('creates a description-only plan without reading Document state', async () => {
    const response = await post({ description });

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    await expect(response.json()).resolves.toEqual({ plan: makeValidMapPlanV3(), sourceToken: null });
    expect(readCreateMapDocumentSource).not.toHaveBeenCalled();
    expect(createMapPlanV3).toHaveBeenCalledWith(description, undefined, { references: [], styleReference: null });
  });

  it.each([
    [
      new Error('LLM_API_KEY is not configured.'),
      'llm_not_configured',
      'Create Map AI is not configured. Set CREATE_MAP_LLM_API_KEY in Vercel Production and redeploy.',
    ],
    [
      new Error('LLM request failed (401): invalid key'),
      'llm_upstream_error',
      'Create Map AI request failed. Verify the Vercel Production API key, URL, and model, then redeploy.',
    ],
  ])('returns an actionable sanitized planner configuration error', async (cause, code, error) => {
    createMapPlanV3.mockRejectedValueOnce(cause);

    const response = await post({ description });

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ code, error });
  });

  it('requires projectId with documentId', async () => {
    expect((await post({ schemaVersion: 3, description, documentId })).status).toBe(400);
    expect(readCreateMapDocumentSource).not.toHaveBeenCalled();
  });

  it('uses authorized optional Document context without echoing markdown', async () => {
    const response = await post({ schemaVersion: 3, description, projectId, documentId });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(readCreateMapDocumentSource).toHaveBeenCalledWith(supabase, 'user-1', projectId, documentId);
    expect(createMapPlanV3).toHaveBeenCalledWith(description, source, { references: [], styleReference: null });
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
    expect((await post({ schemaVersion: 3, description, projectId, documentId })).status).toBe(403);

    readCreateMapDocumentSource.mockRejectedValueOnce(new MockDocumentSourceError('document_project_mismatch'));
    expect((await post({ schemaVersion: 3, description, projectId, documentId })).status).toBe(403);
    expect(createMapPlanV3).not.toHaveBeenCalled();
  });

  it.each([
    ['V1 schema', { schemaVersion: 1, description }],
    ['V2 schema', { schemaVersion: 2, description }],
    ['string V2 schema', { schemaVersion: '2', description }],
    ['string V3 schema', { schemaVersion: '3', description }],
    ['legacy document-only request', { schemaVersion: 1, projectId, documentId }],
    ['legacy request fields', { schemaVersion: 2, description, generationMode: 'layered' }],
  ])('rejects %s before planning', async (_label, body) => {
    expect((await post(body)).status).toBe(400);
    expect(createMapPlanV3).not.toHaveBeenCalled();
  });

  it('loads only authorized V3 reference records and passes their IDs and hashes to the planner', async () => {
    referenceRows.mockResolvedValue({
      data: [
        { id: referenceId, project_id: projectId, sha256: 'a'.repeat(64) },
        { id: styleReferenceId, project_id: projectId, sha256: 'b'.repeat(64) },
      ],
      error: null,
    });
    const response = await post({
      schemaVersion: 3,
      description,
      projectId,
      documentId,
      referenceIds: [referenceId],
      styleReferenceId,
      referenceRoles: { [referenceId]: 'layout' },
      referenceUsage: { [referenceId]: 'preserve the village composition' },
      styleCopy: ['color_palette', 'outline'],
    });

    expect(response.status).toBe(200);
    expect(readCreateMapDocumentSource).toHaveBeenCalledWith(supabase, 'user-1', projectId, documentId);
    expect(createMapPlanV3).toHaveBeenCalledWith(description, source, {
      references: [{
        assetId: referenceId,
        sha256: 'a'.repeat(64),
        role: 'layout',
        usage: 'preserve the village composition',
      }],
      styleReference: {
        assetId: styleReferenceId,
        sha256: 'b'.repeat(64),
        copy: ['color_palette', 'outline'],
      },
    });
    expect(referenceSelect).toHaveBeenCalledWith('id, project_id, sha256');
    expect(referenceEq).toHaveBeenCalledWith('project_id', projectId);
    expect(referenceIn).toHaveBeenCalledWith('id', [referenceId, styleReferenceId]);
  });

  it('rejects V3 reference selections that are not an exact project-scoped registry match', async () => {
    referenceRows.mockResolvedValue({
      data: [{ id: referenceId, project_id: projectId, sha256: 'a'.repeat(64) }],
      error: null,
    });

    const response = await post({
      schemaVersion: 3,
      description,
      projectId,
      referenceIds: [referenceId],
      styleReferenceId,
      referenceRoles: { [referenceId]: 'content' },
      referenceUsage: { [referenceId]: 'market layout' },
      styleCopy: ['detail'],
    });

    expect(response.status).toBe(400);
    expect(createMapPlanV3).not.toHaveBeenCalled();
  });

  it('rejects incompatible reference fields and missing V3 reference project IDs', async () => {
    expect((await post({
      schemaVersion: 3,
      description,
      referenceIds: [referenceId],
      referenceRoles: { [referenceId]: 'content' },
      referenceUsage: { [referenceId]: 'market layout' },
    })).status).toBe(400);
    expect(createMapPlanV3).not.toHaveBeenCalled();
  });
});
