import { NextRequest } from 'next/server';

const publishImportedDocumentAsActor = jest.fn();
let authenticatedUser: { id: string } | null = null;
const withAuth = jest.fn((handler: unknown, options: {
  unauthorizedResponse?: () => Response;
} = {}) => async (request: NextRequest, context?: unknown) => {
  if (!authenticatedUser) {
    return options.unauthorizedResponse?.() ?? Response.json(
      { error: 'Please sign in to continue' },
      { status: 401 }
    );
  }
  return (handler as (
    request: NextRequest,
    context: unknown,
    auth: { supabase: object; user: { id: string } }
  ) => Promise<Response>)(request, context, { supabase: {}, user: authenticatedUser });
});

jest.mock('@/lib/server/documentImportPublishService', () => ({
  publishImportedDocumentAsActor: (...args: unknown[]) => publishImportedDocumentAsActor(...args),
}));
jest.mock('@/lib/auth/route-auth', () => ({
  withAuth: (...args: unknown[]) => withAuth(...args),
}));

import { maxDuration, POST } from '@/app/api/documents/import/route';

const body = {
  documentId: '33333333-3333-4333-8333-333333333333',
  versionId: '44444444-4444-4444-8444-444444444444',
  projectId: '11111111-1111-4111-8111-111111111111',
  folderId: null,
  name: 'Guide',
  markdown: '# Guide',
};

function request(value: unknown = body) {
  return new NextRequest('https://example.test/api/documents/import', {
    method: 'POST',
    body: JSON.stringify(value),
    headers: { 'content-type': 'application/json', authorization: 'Bearer token' },
  });
}

function post(value: unknown = body) {
  return POST(request(value), undefined);
}

describe('document import route', () => {
  beforeEach(() => {
    publishImportedDocumentAsActor.mockReset();
    authenticatedUser = { id: '22222222-2222-4222-8222-222222222222' };
    publishImportedDocumentAsActor.mockResolvedValue({
      id: body.documentId,
      ...body,
    });
  });

  it('derives the actor from authentication and publishes semantic Markdown', async () => {
    const response = await post();

    expect(response.status).toBe(200);
    expect(publishImportedDocumentAsActor).toHaveBeenCalledWith({
      actorUserId: '22222222-2222-4222-8222-222222222222',
      ...body,
    });
  });

  it('rejects malformed, unauthenticated, and unauthorized imports', async () => {
    expect((await post({ ...body, extra: true })).status).toBe(400);
    authenticatedUser = null;
    expect((await post()).status).toBe(401);
    authenticatedUser = { id: '22222222-2222-4222-8222-222222222222' };
    publishImportedDocumentAsActor.mockRejectedValueOnce({ code: '42501' });
    expect((await post()).status).toBe(403);
    publishImportedDocumentAsActor.mockRejectedValueOnce({ code: '22023' });
    expect((await post()).status).toBe(409);
  });

  it('uses shared authentication and a 60-second route duration', () => {
    expect(withAuth).toHaveBeenCalledTimes(1);
    expect(maxDuration).toBe(60);
  });
});
