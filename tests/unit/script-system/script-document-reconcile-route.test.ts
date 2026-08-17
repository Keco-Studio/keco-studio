import { NextRequest } from 'next/server';
import { DocumentStateConflictError } from '@/lib/documents/documentStateTypes';

const reconcileScriptLibrariesFromDocument = jest.fn();
const authedSupabase = { source: 'withAuth' };
let authenticated = true;
const withAuth = jest.fn((handler: unknown) => async (request: NextRequest) => {
  if (!authenticated) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  return (handler as Function)(request, undefined, {
    supabase: authedSupabase,
    user: { id: USER_ID },
  });
});

jest.mock('@/lib/auth/route-auth', () => ({
  withAuth: (...args: unknown[]) => withAuth(...args),
}));
jest.mock('@/lib/server/scriptDocumentReconciliationService', () => ({
  reconcileScriptLibrariesFromDocument: (...args: unknown[]) => reconcileScriptLibrariesFromDocument(...args),
}));

import { POST } from '@/app/api/script-document-reconcile/route';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const DOCUMENT_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const LIBRARY_ID = '44444444-4444-4444-8444-444444444444';
const validBody = {
  projectId: PROJECT_ID,
  documentId: DOCUMENT_ID,
  expected: { epoch: 3, revision: 4 },
  previousMarkdown: 'before',
  markdown: 'after',
};

function post(body: unknown = validBody): Promise<Response> {
  return POST(new NextRequest('https://example.test/api/script-document-reconcile', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  }), undefined);
}

describe('script document reconciliation route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    authenticated = true;
    reconcileScriptLibrariesFromDocument.mockResolvedValue({
      updatedLibraries: 1,
      updatedLibraryIds: [LIBRARY_ID],
      ambiguous: false,
    });
  });

  it('passes authenticated compacted snapshots to the reconciliation service', async () => {
    const response = await post();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      updatedLibraries: 1,
      updatedLibraryIds: [LIBRARY_ID],
      ambiguous: false,
    });
    expect(reconcileScriptLibrariesFromDocument).toHaveBeenCalledWith({
      supabase: authedSupabase,
      actorUserId: USER_ID,
      ...validBody,
    });
  });

  it('returns 204 for a no-op and 409 for an ambiguous change', async () => {
    reconcileScriptLibrariesFromDocument.mockResolvedValueOnce({
      updatedLibraries: 0,
      updatedLibraryIds: [],
      ambiguous: false,
    });
    expect((await post()).status).toBe(204);

    reconcileScriptLibrariesFromDocument.mockResolvedValueOnce({
      updatedLibraries: 0,
      updatedLibraryIds: [],
      ambiguous: true,
    });
    const ambiguous = await post();
    expect(ambiguous.status).toBe(409);
    await expect(ambiguous.json()).resolves.toEqual({ code: 'MAPPING_AMBIGUOUS' });
  });

  it('rejects unauthenticated and malformed requests', async () => {
    authenticated = false;
    expect((await post()).status).toBe(401);
    expect(reconcileScriptLibrariesFromDocument).not.toHaveBeenCalled();

    authenticated = true;
    expect((await post({ ...validBody, documentId: 'not-a-uuid' })).status).toBe(400);
    expect((await post({ ...validBody, expected: { epoch: 1.5, revision: 2 } })).status).toBe(400);
  });

  it('maps stale documents and access failures without exposing internals', async () => {
    reconcileScriptLibrariesFromDocument.mockRejectedValueOnce(
      new DocumentStateConflictError('changed', { epoch: 4, revision: 5 }),
    );
    expect((await post()).status).toBe(409);

    reconcileScriptLibrariesFromDocument.mockRejectedValueOnce(new Error('FORBIDDEN'));
    expect((await post()).status).toBe(403);

    reconcileScriptLibrariesFromDocument.mockRejectedValueOnce(
      new Error('DERIVED_TABLE_MAPPING_AMBIGUOUS'),
    );
    const ambiguous = await post();
    expect(ambiguous.status).toBe(409);
    await expect(ambiguous.json()).resolves.toEqual({ code: 'MAPPING_AMBIGUOUS' });

    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    reconcileScriptLibrariesFromDocument.mockRejectedValueOnce(new Error('private detail'));
    const failed = await post();
    expect(failed.status).toBe(500);
    await expect(failed.json()).resolves.toEqual({ code: 'SYNC_FAILED' });
    errorSpy.mockRestore();
  });
});
