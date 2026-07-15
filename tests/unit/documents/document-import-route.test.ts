import { NextRequest } from 'next/server';

const publishImportedDocumentAsActor = jest.fn();
const getUser = jest.fn();
const createSupabaseServerClient = jest.fn(() => ({ auth: { getUser } }));

jest.mock('@/lib/server/documentImportPublishService', () => ({
  publishImportedDocumentAsActor: (...args: unknown[]) => publishImportedDocumentAsActor(...args),
}));
jest.mock('@/lib/createSupabaseServerClient', () => ({
  createSupabaseServerClient: (...args: unknown[]) => createSupabaseServerClient(...args),
}));

import { POST } from '@/app/api/documents/import/route';

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

describe('document import route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getUser.mockResolvedValue({
      data: { user: { id: '22222222-2222-4222-8222-222222222222' } },
      error: null,
    });
    publishImportedDocumentAsActor.mockResolvedValue({
      id: body.documentId,
      ...body,
    });
  });

  it('derives the actor from authentication and publishes semantic Markdown', async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(publishImportedDocumentAsActor).toHaveBeenCalledWith({
      actorUserId: '22222222-2222-4222-8222-222222222222',
      ...body,
    });
  });

  it('rejects malformed, unauthenticated, and unauthorized imports', async () => {
    expect((await POST(request({ ...body, extra: true }))).status).toBe(400);
    getUser.mockResolvedValueOnce({ data: { user: null }, error: new Error('no session') });
    expect((await POST(request())).status).toBe(401);
    publishImportedDocumentAsActor.mockRejectedValueOnce({ code: '42501' });
    expect((await POST(request())).status).toBe(403);
    publishImportedDocumentAsActor.mockRejectedValueOnce({ code: '22023' });
    expect((await POST(request())).status).toBe(409);
  });
});
