import { NextRequest } from 'next/server';

const getDocumentExportSource = jest.fn();
const authedSupabase = { source: 'withAuth' };
let authenticated = true;
const withAuth = jest.fn((handler: unknown) => async (
  request: NextRequest,
  context: { params: Promise<{ documentId: string }> }
) => {
  if (!authenticated) {
    return Response.json({ error: 'Please sign in to continue' }, { status: 401 });
  }
  return (handler as (
    request: NextRequest,
    context: { params: Promise<{ documentId: string }> },
    auth: { supabase: object; user: { id: string } }
  ) => Promise<Response>)(request, context, {
    supabase: authedSupabase,
    user: { id: 'user-id' },
  });
});

jest.mock('@/lib/server/documentExportSourceService', () => ({
  getDocumentExportSource: (...args: unknown[]) => getDocumentExportSource(...args),
}));
jest.mock('@/lib/auth/route-auth', () => ({
  withAuth: (...args: unknown[]) => withAuth(...args),
}));

import { GET } from '@/app/api/documents/[documentId]/export-source/route';

const DOCUMENT_ID = '11111111-1111-4111-8111-111111111111';
const source = {
  documentId: DOCUMENT_ID,
  documentName: 'World Notes',
  projectId: '22222222-2222-4222-8222-222222222222',
  folderId: null,
  markdown: '# Latest\nBody',
  token: { epoch: 2, revision: 7 },
};

function get(documentId = DOCUMENT_ID) {
  return GET(
    new NextRequest(`https://example.test/api/documents/${documentId}/export-source`),
    { params: Promise.resolve({ documentId }) }
  );
}

describe('document export source route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    authenticated = true;
    getDocumentExportSource.mockResolvedValue(source);
  });

  it('returns the frozen source without allowing caches to retain it', async () => {
    const response = await get();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ source });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(getDocumentExportSource).toHaveBeenCalledWith(
      authedSupabase,
      'user-id',
      DOCUMENT_ID
    );
  });

  it('rejects invalid document ids before calling the service', async () => {
    const response = await get('not-a-uuid');

    expect(response.status).toBe(400);
    expect(getDocumentExportSource).not.toHaveBeenCalled();
  });

  it.each([
    ['Only admin users can export project content', 403],
    ['Document is empty', 400],
    ['Document not found or not accessible', 404],
  ])('maps %s to %i', async (message, status) => {
    getDocumentExportSource.mockRejectedValue(new Error(message));

    expect((await get()).status).toBe(status);
  });

  it('maps authorization lookup failures to forbidden', async () => {
    const error = new Error('User is not a collaborator of this project');
    error.name = 'AuthorizationError';
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    getDocumentExportSource.mockRejectedValue(error);

    const response = await get();

    expect(response.status).toBe(403);
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('does not leak unexpected errors', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    getDocumentExportSource.mockRejectedValue(new Error('database password leaked'));

    const response = await get();

    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain('database password leaked');
    expect(consoleError).toHaveBeenCalledWith(
      '[GET /api/documents/[documentId]/export-source] Export source failed',
      { name: 'Error' }
    );
    consoleError.mockRestore();
  });

  it('uses shared authentication', async () => {
    authenticated = false;

    expect((await get()).status).toBe(401);
  });
});
