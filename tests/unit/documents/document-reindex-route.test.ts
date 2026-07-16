import { NextRequest } from 'next/server';

const reindexProjectDocumentAsActor = jest.fn();
class ProjectDocumentIndexAccessError extends Error {}
let authenticatedUser: { id: string } | null = null;
const withAuth = jest.fn((handler: unknown) => async (request: NextRequest) => {
  if (!authenticatedUser) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  return (handler as Function)(request, undefined, {
    supabase: {},
    user: authenticatedUser,
  });
});

jest.mock('@/lib/auth/route-auth', () => ({ withAuth: (...args: unknown[]) => withAuth(...args) }));
jest.mock('@/lib/server/documentEmbeddingIndexService', () => ({
  ProjectDocumentIndexAccessError,
  reindexProjectDocumentAsActor: (...args: unknown[]) => reindexProjectDocumentAsActor(...args),
}));

import { POST } from '@/app/api/agent-chat/reindex/document/route';

const ACTOR_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const DOCUMENT_ID = '33333333-3333-4333-8333-333333333333';

function post(body: unknown) {
  return POST(
    new NextRequest('https://example.test/api/agent-chat/reindex/document', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    }),
    undefined
  );
}

describe('document reindex route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    authenticatedUser = { id: ACTOR_ID };
    reindexProjectDocumentAsActor.mockResolvedValue({ documentId: DOCUMENT_ID, chunks: 2 });
  });

  it('strictly validates scope and invokes the actor-checked service', async () => {
    const response = await post({ projectId: PROJECT_ID, documentId: DOCUMENT_ID });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, documentId: DOCUMENT_ID, chunks: 2 });
    expect(reindexProjectDocumentAsActor).toHaveBeenCalledWith({
      actorUserId: ACTOR_ID,
      projectId: PROJECT_ID,
      documentId: DOCUMENT_ID,
    });

    expect((await post({ projectId: PROJECT_ID, documentId: DOCUMENT_ID, extra: true })).status).toBe(400);
    expect((await post({ projectId: PROJECT_ID, documentId: 'not-a-uuid' })).status).toBe(400);
  });

  it('rejects unauthenticated and mismatched project/document access', async () => {
    authenticatedUser = null;
    expect((await post({ projectId: PROJECT_ID, documentId: DOCUMENT_ID })).status).toBe(401);

    authenticatedUser = { id: ACTOR_ID };
    reindexProjectDocumentAsActor.mockRejectedValueOnce(new Error('Document project mismatch'));
    expect((await post({ projectId: PROJECT_ID, documentId: DOCUMENT_ID })).status).toBe(403);
  });
});
