import { NextRequest } from 'next/server';

const AUTH_USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BOUND_PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const MALICIOUS_PROJECT_ID = '99999999-9999-4999-8999-999999999999';
const DOCUMENT_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_DOCUMENT_ID = '33333333-3333-4333-8333-333333333333';

const authedSupabase = { source: 'withAuth' };
const runAgentTurn = jest.fn();
const resumeAgentTurn = jest.fn();
const getOrCreateConversation = jest.fn();
const getConversation = jest.fn();
const loadPendingAction = jest.fn();
const resolveUserRole = jest.fn();
const resolveDocumentForTool = jest.fn();
const getDocumentExportSource = jest.fn();
const sseResponse = jest.fn(() => new Response(null));
const withAuth = jest.fn(
  (handler: unknown) =>
    async (request: NextRequest, context?: unknown) =>
      (handler as (
        request: NextRequest,
        context: unknown,
        auth: { supabase: object; user: { id: string } }
      ) => Promise<Response>)(request, context, {
        supabase: authedSupabase,
        user: { id: AUTH_USER_ID },
      })
);

jest.mock('@/lib/auth/route-auth', () => ({
  withAuth: (...args: unknown[]) => withAuth(...args),
}));
jest.mock('@/lib/agent/core', () => ({
  runAgentTurn: (...args: unknown[]) => runAgentTurn(...args),
  resumeAgentTurn: (...args: unknown[]) => resumeAgentTurn(...args),
}));
jest.mock('@/lib/agent/conversation-store', () => ({
  getOrCreateConversation: (...args: unknown[]) => getOrCreateConversation(...args),
  getConversation: (...args: unknown[]) => getConversation(...args),
}));
jest.mock('@/lib/agent/confirmation', () => ({
  loadPendingAction: (...args: unknown[]) => loadPendingAction(...args),
}));
jest.mock('@/lib/agent/permissions', () => ({
  AgentAccessError: class AgentAccessError extends Error {},
  resolveUserRole: (...args: unknown[]) => resolveUserRole(...args),
}));
jest.mock('@/lib/agent/document-resolver', () => ({
  resolveDocumentForTool: (...args: unknown[]) => resolveDocumentForTool(...args),
}));
jest.mock('@/lib/server/documentExportSourceService', () => ({
  getDocumentExportSource: (...args: unknown[]) => getDocumentExportSource(...args),
}));
jest.mock('@/lib/agent/sse', () => ({
  sseResponse: (...args: unknown[]) => sseResponse(...args),
}));

import { POST as chatPost } from '@/app/api/agent-chat/route';
import { POST as confirmPost } from '@/app/api/agent-chat/confirm/route';

const conversation = {
  id: 'conversation-id',
  user_id: AUTH_USER_ID,
  project_id: BOUND_PROJECT_ID,
  title: null,
  meta: { autoExecute: false },
  created_at: '2026-07-16T00:00:00.000Z',
  updated_at: '2026-07-16T00:00:00.000Z',
};
const documentExport = { sourceDocumentId: DOCUMENT_ID, exportType: 'table' as const };

function request(path: string, body: Record<string, unknown>): NextRequest {
  return new NextRequest(`https://example.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function currentDocumentResult(projectId: string, documentId: string) {
  if (projectId === BOUND_PROJECT_ID && documentId === DOCUMENT_ID) {
    return {
      ok: true,
      source: 'id',
      document: { id: DOCUMENT_ID, name: 'Server Document Name' },
    };
  }
  return {
    ok: false,
    code: 'NOT_FOUND',
    error: 'Document was not found in this project.',
  };
}

describe('agent chat route current-document project boundary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getOrCreateConversation.mockResolvedValue(conversation);
    resolveUserRole.mockResolvedValue('editor');
    getDocumentExportSource.mockResolvedValue({
      documentId: DOCUMENT_ID,
      documentName: 'World Notes',
      projectId: BOUND_PROJECT_ID,
      folderId: null,
      markdown: '# World',
      token: { epoch: 1, revision: 1 },
    });
    resolveDocumentForTool.mockImplementation(
      async (_supabase: unknown, projectId: string, input: { documentId: string }) =>
        currentDocumentResult(projectId, input.documentId)
    );
  });

  it('uses the existing conversation project and server-derived document context', async () => {
    const response = await chatPost(
      request('/api/agent-chat', {
        conversationId: conversation.id,
        projectId: MALICIOUS_PROJECT_ID,
        currentDocumentId: ` ${DOCUMENT_ID} `,
        currentDocumentName: 'Client Spoofed Name',
        message: 'Continue editing',
      }),
      undefined
    );

    expect(response.status).toBe(200);
    expect(resolveUserRole).toHaveBeenCalledWith(authedSupabase, BOUND_PROJECT_ID, AUTH_USER_ID);
    expect(resolveDocumentForTool).toHaveBeenCalledWith(
      authedSupabase,
      BOUND_PROJECT_ID,
      { documentId: DOCUMENT_ID },
      {}
    );
    expect(runAgentTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        toolContext: expect.objectContaining({
          projectId: BOUND_PROJECT_ID,
          currentDocumentId: DOCUMENT_ID,
          currentDocumentName: 'Server Document Name',
        }),
      })
    );
  });

  it('omits current-document fields when the id is not in the conversation project', async () => {
    await chatPost(
      request('/api/agent-chat', {
        conversationId: conversation.id,
        projectId: MALICIOUS_PROJECT_ID,
        currentDocumentId: OTHER_DOCUMENT_ID,
        currentDocumentName: 'Client Spoofed Name',
        message: 'Continue editing',
      }),
      undefined
    );

    const toolContext = runAgentTurn.mock.calls[0][0].toolContext;
    expect(toolContext.projectId).toBe(BOUND_PROJECT_ID);
    expect(toolContext).not.toHaveProperty('currentDocumentId');
    expect(toolContext).not.toHaveProperty('currentDocumentName');
  });

  it('validates and persists a table export binding only for a new conversation', async () => {
    resolveUserRole.mockResolvedValue('admin');
    getOrCreateConversation.mockImplementation(async (_supabase, params) => ({
      ...conversation,
      meta: { autoExecute: false, documentExport: params.documentExport },
    }));

    const response = await chatPost(
      request('/api/agent-chat', {
        projectId: BOUND_PROJECT_ID,
        message: 'Generate tables',
        documentExport,
      }),
      undefined
    );

    expect(response.status).toBe(200);
    expect(getDocumentExportSource).toHaveBeenCalledWith(
      authedSupabase,
      AUTH_USER_ID,
      DOCUMENT_ID
    );
    expect(getOrCreateConversation).toHaveBeenCalledWith(
      authedSupabase,
      expect.objectContaining({ documentExport })
    );
    expect(runAgentTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        toolContext: expect.objectContaining({ documentExport }),
        conversationMeta: expect.objectContaining({ documentExport }),
      })
    );
  });

  it('rejects a document table export binding for an editor before creating a conversation', async () => {
    getDocumentExportSource.mockRejectedValue(
      new Error('Only admin users can export project content')
    );

    const response = await chatPost(
      request('/api/agent-chat', {
        projectId: BOUND_PROJECT_ID,
        message: 'Generate tables',
        documentExport,
      }),
      undefined
    );

    expect(response.status).toBe(403);
    expect(getOrCreateConversation).not.toHaveBeenCalled();
    expect(runAgentTurn).not.toHaveBeenCalled();
  });

  it('rejects a document source from another project before creating a conversation', async () => {
    getDocumentExportSource.mockResolvedValue({
      documentId: DOCUMENT_ID,
      documentName: 'Other project notes',
      projectId: MALICIOUS_PROJECT_ID,
      folderId: null,
      markdown: '# Other',
      token: { epoch: 1, revision: 1 },
    });

    const response = await chatPost(
      request('/api/agent-chat', {
        projectId: BOUND_PROJECT_ID,
        message: 'Generate tables',
        documentExport,
      }),
      undefined
    );

    expect(response.status).toBe(400);
    expect(getOrCreateConversation).not.toHaveBeenCalled();
    expect(runAgentTurn).not.toHaveBeenCalled();
  });

  it('ignores a new request binding for an existing conversation', async () => {
    const persistedExport = {
      sourceDocumentId: OTHER_DOCUMENT_ID,
      exportType: 'table' as const,
    };
    getOrCreateConversation.mockResolvedValue({
      ...conversation,
      meta: { autoExecute: false, documentExport: persistedExport },
    });
    resolveUserRole.mockResolvedValue('admin');

    const response = await chatPost(
      request('/api/agent-chat', {
        conversationId: conversation.id,
        projectId: MALICIOUS_PROJECT_ID,
        message: 'Continue',
        documentExport,
      }),
      undefined
    );

    expect(response.status).toBe(200);
    expect(getDocumentExportSource).not.toHaveBeenCalled();
    expect(getOrCreateConversation).toHaveBeenCalledWith(
      authedSupabase,
      expect.not.objectContaining({ documentExport: expect.anything() })
    );
    expect(runAgentTurn.mock.calls[0][0].toolContext.documentExport).toEqual(persistedExport);
  });

  it('rejects an existing bound conversation after the admin is downgraded to editor', async () => {
    getOrCreateConversation.mockResolvedValue({
      ...conversation,
      meta: { autoExecute: false, documentExport },
    });
    resolveUserRole.mockResolvedValue('editor');

    const response = await chatPost(
      request('/api/agent-chat', {
        conversationId: conversation.id,
        projectId: BOUND_PROJECT_ID,
        message: 'Continue generating tables',
      }),
      undefined
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Forbidden' });
    expect(runAgentTurn).not.toHaveBeenCalled();
  });
});

describe('agent confirmation route current-document project boundary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    loadPendingAction.mockResolvedValue({ conversationId: conversation.id });
    getConversation.mockResolvedValue(conversation);
    resolveUserRole.mockResolvedValue('editor');
    resolveDocumentForTool.mockImplementation(
      async (_supabase: unknown, projectId: string, input: { documentId: string }) =>
        currentDocumentResult(projectId, input.documentId)
    );
  });

  it('reconstructs the export binding from conversation meta and ignores the request body', async () => {
    getConversation.mockResolvedValue({
      ...conversation,
      meta: { autoExecute: false, documentExport },
    });
    resolveUserRole.mockResolvedValue('admin');
    const bodyExport = {
      sourceDocumentId: OTHER_DOCUMENT_ID,
      exportType: 'table',
    };

    const response = await confirmPost(
      request('/api/agent-chat/confirm', {
        actionId: 'action-id',
        decision: 'approve',
        documentExport: bodyExport,
      }),
      undefined
    );

    expect(response.status).toBe(200);
    expect(resumeAgentTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        toolContext: expect.objectContaining({ documentExport }),
        conversationMeta: expect.objectContaining({ documentExport }),
      })
    );
    expect(resumeAgentTurn.mock.calls[0][0].toolContext.documentExport).not.toEqual(bodyExport);
  });

  it('rejects a bound confirmation after the admin is downgraded to editor', async () => {
    getConversation.mockResolvedValue({
      ...conversation,
      meta: { autoExecute: false, documentExport },
    });
    resolveUserRole.mockResolvedValue('editor');

    const response = await confirmPost(
      request('/api/agent-chat/confirm', {
        actionId: 'action-id',
        decision: 'approve',
      }),
      undefined
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Forbidden' });
    expect(resumeAgentTurn).not.toHaveBeenCalled();
  });

  it('resolves the live document against the pending conversation project', async () => {
    const response = await confirmPost(
      request('/api/agent-chat/confirm', {
        actionId: 'action-id',
        decision: 'approve',
        currentDocumentId: ` ${DOCUMENT_ID} `,
        currentDocumentName: 'Client Spoofed Name',
        currentFolderId: 'live-folder-id',
        currentFolderName: 'Live Folder',
      }),
      undefined
    );

    expect(response.status).toBe(200);
    expect(loadPendingAction).toHaveBeenCalledWith(
      authedSupabase,
      'action-id',
      AUTH_USER_ID
    );
    expect(resolveDocumentForTool).toHaveBeenCalledWith(
      authedSupabase,
      BOUND_PROJECT_ID,
      { documentId: DOCUMENT_ID },
      {}
    );
    expect(resumeAgentTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        toolContext: expect.objectContaining({
          projectId: BOUND_PROJECT_ID,
          currentDocumentId: DOCUMENT_ID,
          currentDocumentName: 'Server Document Name',
          currentFolderId: 'live-folder-id',
          currentFolderName: 'Live Folder',
        }),
      })
    );
  });

  it('omits current-document fields when the live id is outside the conversation project', async () => {
    await confirmPost(
      request('/api/agent-chat/confirm', {
        actionId: 'action-id',
        decision: 'reject',
        currentDocumentId: OTHER_DOCUMENT_ID,
        currentDocumentName: 'Client Spoofed Name',
      }),
      undefined
    );

    const toolContext = resumeAgentTurn.mock.calls[0][0].toolContext;
    expect(toolContext.projectId).toBe(BOUND_PROJECT_ID);
    expect(toolContext).not.toHaveProperty('currentDocumentId');
    expect(toolContext).not.toHaveProperty('currentDocumentName');
  });
});
