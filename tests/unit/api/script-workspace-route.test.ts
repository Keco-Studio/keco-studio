import { NextRequest } from 'next/server';

const listScriptWorkspaceDocuments = jest.fn();
const upsertScriptWorkspaceDocument = jest.fn();
const deleteScriptWorkspaceDocument = jest.fn();
const getUserProjectRole = jest.fn();

let authenticatedUser: { id: string } | null = null;
let mockSupabase: object = {};

const withAuth = jest.fn(
  (
    handler: unknown,
    options: { unauthorizedResponse?: () => Response } = {}
  ) =>
    async (request: NextRequest, context?: unknown) => {
      if (!authenticatedUser) {
        return (
          options.unauthorizedResponse?.() ??
          Response.json({ error: 'Please sign in to continue' }, { status: 401 })
        );
      }
      return (
        handler as (
          request: NextRequest,
          context: unknown,
          auth: { supabase: object; user: { id: string } }
        ) => Promise<Response>
      )(request, context, { supabase: mockSupabase, user: authenticatedUser });
    }
);

jest.mock('@/lib/script-system/scriptWorkspaceService', () => ({
  listScriptWorkspaceDocuments: (...args: unknown[]) =>
    listScriptWorkspaceDocuments(...args),
  upsertScriptWorkspaceDocument: (...args: unknown[]) =>
    upsertScriptWorkspaceDocument(...args),
  deleteScriptWorkspaceDocument: (...args: unknown[]) =>
    deleteScriptWorkspaceDocument(...args),
}));
jest.mock('@/lib/auth/route-auth', () => ({
  withAuth: (...args: unknown[]) => withAuth(...args),
}));
jest.mock('@/lib/services/authorizationService', () => ({
  AuthorizationError: class AuthorizationError extends Error {
    name = 'AuthorizationError';
  },
  getUserProjectRole: (...args: unknown[]) => getUserProjectRole(...args),
}));

import { GET, POST } from '@/app/api/script-workspace/[projectId]/route';
import { DELETE } from '@/app/api/script-workspace/[projectId]/[documentId]/route';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const DOCUMENT_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '44444444-4444-4444-8444-444444444444';

const params = { params: Promise.resolve({ projectId: PROJECT_ID }) };
const deleteParams = {
  params: Promise.resolve({ projectId: PROJECT_ID, documentId: DOCUMENT_ID }),
};

function documentsClient(docs: Array<{ id: string; name: string; folder_id: string | null }>) {
  return {
    from: (table: string) => {
      if (table !== 'documents') throw new Error(`Unexpected table ${table}`);
      return {
        select: () => ({
          in: async () => ({ data: docs, error: null }),
        }),
      };
    },
  };
}

describe('script-workspace API routes', () => {
  beforeEach(() => {
    listScriptWorkspaceDocuments.mockReset();
    upsertScriptWorkspaceDocument.mockReset();
    deleteScriptWorkspaceDocument.mockReset();
    getUserProjectRole.mockReset();
    authenticatedUser = { id: USER_ID };
    mockSupabase = documentsClient([]);
    getUserProjectRole.mockResolvedValue({ role: 'editor' });
    listScriptWorkspaceDocuments.mockResolvedValue([]);
    upsertScriptWorkspaceDocument.mockResolvedValue(undefined);
    deleteScriptWorkspaceDocument.mockResolvedValue(undefined);
  });

  describe('GET /api/script-workspace/:projectId', () => {
    it('returns 401 when unauthenticated', async () => {
      authenticatedUser = null;
      const response = await GET(
        new NextRequest(`https://example.test/api/script-workspace/${PROJECT_ID}`),
        params
      );
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({ error: 'unauthorized' });
    });

    it('returns 403 when user lacks project access', async () => {
      const { AuthorizationError } = await import('@/lib/services/authorizationService');
      getUserProjectRole.mockRejectedValue(new AuthorizationError('Forbidden'));
      const response = await GET(
        new NextRequest(`https://example.test/api/script-workspace/${PROJECT_ID}`),
        params
      );
      expect(response.status).toBe(403);
    });

    it('lists workspace documents with joined title and folderId', async () => {
      listScriptWorkspaceDocuments.mockResolvedValue([
        {
          project_id: PROJECT_ID,
          document_id: DOCUMENT_ID,
          imported_at: '2026-07-31T12:00:00.000Z',
          imported_by: USER_ID,
        },
      ]);
      mockSupabase = documentsClient([
        { id: DOCUMENT_ID, name: 'Intro Scene', folder_id: null },
      ]);

      const response = await GET(
        new NextRequest(`https://example.test/api/script-workspace/${PROJECT_ID}`),
        params
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        documents: [
          {
            documentId: DOCUMENT_ID,
            importedAt: '2026-07-31T12:00:00.000Z',
            title: 'Intro Scene',
            folderId: null,
          },
        ],
      });
      expect(listScriptWorkspaceDocuments).toHaveBeenCalledWith(mockSupabase, PROJECT_ID);
    });
  });

  describe('POST /api/script-workspace/:projectId', () => {
    function postRequest(body: unknown = { documentId: DOCUMENT_ID }) {
      return POST(
        new NextRequest(`https://example.test/api/script-workspace/${PROJECT_ID}`, {
          method: 'POST',
          body: JSON.stringify(body),
          headers: { 'content-type': 'application/json' },
        }),
        params
      );
    }

    it('returns 401 when unauthenticated', async () => {
      authenticatedUser = null;
      expect((await postRequest()).status).toBe(401);
    });

    it('upserts workspace reference via service', async () => {
      const response = await postRequest();
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ ok: true });
      expect(upsertScriptWorkspaceDocument).toHaveBeenCalledWith(mockSupabase, {
        projectId: PROJECT_ID,
        documentId: DOCUMENT_ID,
        userId: USER_ID,
      });
    });

    it('returns 400 when documentId is missing', async () => {
      expect((await postRequest({})).status).toBe(400);
      expect(upsertScriptWorkspaceDocument).not.toHaveBeenCalled();
    });

    it('returns 404 when document is not in project', async () => {
      upsertScriptWorkspaceDocument.mockRejectedValue(
        new Error('Document not found in project')
      );
      expect((await postRequest()).status).toBe(404);
    });

    it('returns 403 on RLS denial', async () => {
      upsertScriptWorkspaceDocument.mockRejectedValue({ code: '42501' });
      expect((await postRequest()).status).toBe(403);
    });
  });

  describe('DELETE /api/script-workspace/:projectId/:documentId', () => {
    function deleteRequest() {
      return DELETE(
        new NextRequest(
          `https://example.test/api/script-workspace/${PROJECT_ID}/${DOCUMENT_ID}`,
          { method: 'DELETE' }
        ),
        deleteParams
      );
    }

    it('returns 401 when unauthenticated', async () => {
      authenticatedUser = null;
      expect((await deleteRequest()).status).toBe(401);
    });

    it('deletes workspace reference via service', async () => {
      const response = await deleteRequest();
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ ok: true });
      expect(deleteScriptWorkspaceDocument).toHaveBeenCalledWith(mockSupabase, {
        projectId: PROJECT_ID,
        documentId: DOCUMENT_ID,
      });
    });

    it('returns 403 on RLS denial', async () => {
      deleteScriptWorkspaceDocument.mockRejectedValue({ code: '42501' });
      expect((await deleteRequest()).status).toBe(403);
    });
  });

  it('wraps handlers with withAuth', () => {
    expect(withAuth).toHaveBeenCalledTimes(3);
  });
});
