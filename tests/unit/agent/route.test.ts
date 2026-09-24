import { NextRequest } from 'next/server';

jest.mock('server-only', () => ({}));

const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_PROJECT_ID = '99999999-9999-4999-8999-999999999999';
const supabase = {};
const runAgentTurn = jest.fn();
const resumeAgentTurn = jest.fn();
const getOrCreateConversation = jest.fn();
const getConversation = jest.fn();
const loadPendingAction = jest.fn();
const resolveUserRole = jest.fn();
const resolveCurrentDocumentContext = jest.fn();

jest.mock('@/lib/auth/route-auth', () => ({
  withAuth: (handler: Function) => (request: NextRequest) =>
    handler(request, undefined, { supabase, user: { id: USER_ID } }),
}));
jest.mock('@/lib/agent/core', () => ({ runAgentTurn, resumeAgentTurn }));
jest.mock('@/lib/agent/conversation-store', () => ({ getOrCreateConversation, getConversation }));
jest.mock('@/lib/agent/confirmation', () => ({ loadPendingAction }));
jest.mock('@/lib/agent/permissions', () => ({
  AgentAccessError: class AgentAccessError extends Error {},
  resolveUserRole,
}));
jest.mock('@/lib/agent/current-document-context', () => ({ resolveCurrentDocumentContext }));
jest.mock('@/lib/agent/sse', () => ({ sseResponse: () => new Response(null) }));
jest.mock('@/lib/server/documentExportSourceService', () => ({ getDocumentExportSource: jest.fn() }));
jest.mock('@/lib/server/documentExportSnapshotSigning', () => ({ verifyDocumentExportSnapshotToken: jest.fn() }));
jest.mock('@/lib/design-message', () => ({ buildDesignMessage: jest.fn() }));

import { POST as chatPost } from '@/app/api/agent-chat/route';
import { POST as confirmPost } from '@/app/api/agent-chat/confirm/route';

const conversation = {
  id: 'conversation-1',
  user_id: USER_ID,
  project_id: PROJECT_ID,
  meta: { scope: { level: 'project', projectId: PROJECT_ID, workspace: 'script' } },
};

function request(path: string, body: Record<string, unknown>): NextRequest {
  return new NextRequest(`https://example.test${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
}

describe('agent workspace route binding', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getConversation.mockResolvedValue(conversation);
    getOrCreateConversation.mockResolvedValue(conversation);
    loadPendingAction.mockResolvedValue({ conversationId: conversation.id, suspendedState: { turnId: 'turn-1' } });
    resolveUserRole.mockResolvedValue('editor');
    resolveCurrentDocumentContext.mockResolvedValue({});
  });

  it.each(['projects', 'script', 'create-map', 'game-design-systems'])(
    'accepts a new %s conversation without a project', async (workspace) => {
      const accountConversation = {
        ...conversation,
        project_id: null,
        meta: { scope: { level: 'global', workspace } },
      };
      getOrCreateConversation.mockResolvedValue(accountConversation);

      const response = await chatPost(request('/api/agent-chat', { workspace, message: 'Hello' }));

      expect(response.status).toBe(200);
      expect(getOrCreateConversation).toHaveBeenCalledWith(supabase, expect.objectContaining({
        projectId: null,
        scope: { level: 'global', workspace },
      }));
      expect(resolveUserRole).not.toHaveBeenCalled();
      expect(resolveCurrentDocumentContext).not.toHaveBeenCalled();
      expect(runAgentTurn).toHaveBeenCalledWith(expect.objectContaining({
        toolContext: expect.objectContaining({ workspace, projectId: undefined, userRole: undefined }),
        usageBinding: expect.objectContaining({
          context: expect.objectContaining({ actorUserId: USER_ID, operation: 'react_iteration' }),
        }),
      }));
      expect(runAgentTurn.mock.calls[0][0].usageBinding.context).not.toHaveProperty('projectId');
    }
  );

  it('rejects Studio without a project and invalid workspace values', async () => {
    const studio = await chatPost(request('/api/agent-chat', { workspace: 'studio', message: 'Hello' }));
    const invalid = await chatPost(request('/api/agent-chat', { workspace: 'unknown', message: 'Hello' }));

    expect(studio.status).toBe(400);
    expect(invalid.status).toBe(400);
    expect(getOrCreateConversation).not.toHaveBeenCalled();
  });

  it('uses stored project and workspace for an existing conversation after navigation changes', async () => {
    const response = await chatPost(request('/api/agent-chat', {
      conversationId: conversation.id,
      projectId: OTHER_PROJECT_ID,
      workspace: 'studio',
      currentFolderId: 'live-folder',
      message: 'Continue',
    }));

    expect(response.status).toBe(200);
    expect(getConversation).toHaveBeenCalledTimes(1);
    expect(getOrCreateConversation).not.toHaveBeenCalled();
    expect(resolveUserRole).toHaveBeenCalledWith(supabase, PROJECT_ID, USER_ID);
    expect(runAgentTurn.mock.calls[0][0].toolContext).toEqual(expect.objectContaining({
      projectId: PROJECT_ID, workspace: 'script', currentFolderId: undefined,
    }));
  });

  it('uses a stored null binding for an existing account conversation', async () => {
    const accountConversation = {
      ...conversation,
      project_id: null,
      meta: { scope: { level: 'global', workspace: 'game-design-systems' } },
    };
    getConversation.mockResolvedValue(accountConversation);
    getOrCreateConversation.mockResolvedValue(accountConversation);

    const response = await chatPost(request('/api/agent-chat', {
      conversationId: conversation.id,
      projectId: OTHER_PROJECT_ID,
      workspace: 'studio',
      message: 'Continue',
    }));

    expect(response.status).toBe(200);
    expect(getConversation).toHaveBeenCalledTimes(1);
    expect(getOrCreateConversation).not.toHaveBeenCalled();
    expect(resolveUserRole).not.toHaveBeenCalled();
    expect(runAgentTurn.mock.calls[0][0].toolContext.workspace).toBe('game-design-systems');
    expect(runAgentTurn.mock.calls[0][0].usageBinding.context).not.toHaveProperty('projectId');
  });

  it('rejects an existing conversation owned by another user', async () => {
    getConversation.mockResolvedValue({ ...conversation, user_id: 'another-user' });
    const response = await chatPost(request('/api/agent-chat', {
      conversationId: conversation.id, message: 'Continue',
    }));

    expect(response.status).toBe(404);
    expect(getOrCreateConversation).not.toHaveBeenCalled();
  });

  it('resumes from stored account workspace and project binding', async () => {
    getConversation.mockResolvedValue({
      ...conversation,
      project_id: null,
      meta: { scope: { level: 'global', workspace: 'create-map' } },
    });
    const response = await confirmPost(request('/api/agent-chat/confirm', {
      actionId: 'action-1', decision: 'approve', workspace: 'studio',
      currentFolderId: 'live-folder', currentDocumentId: OTHER_PROJECT_ID,
    }));

    expect(response.status).toBe(200);
    expect(resolveUserRole).not.toHaveBeenCalled();
    expect(resolveCurrentDocumentContext).not.toHaveBeenCalled();
    expect(resumeAgentTurn.mock.calls[0][0].toolContext).toEqual(expect.objectContaining({
      projectId: undefined, workspace: 'create-map', currentFolderId: undefined,
    }));
    expect(resumeAgentTurn.mock.calls[0][0].usageBinding.context).not.toHaveProperty('projectId');
  });

  it('resumes a project conversation from stored scope after navigation changes', async () => {
    const response = await confirmPost(request('/api/agent-chat/confirm', {
      actionId: 'action-1', decision: 'approve', projectId: OTHER_PROJECT_ID,
      workspace: 'studio', currentFolderId: 'live-folder',
    }));

    expect(response.status).toBe(200);
    expect(resolveUserRole).toHaveBeenCalledWith(supabase, PROJECT_ID, USER_ID);
    expect(resumeAgentTurn.mock.calls[0][0].toolContext).toEqual(expect.objectContaining({
      projectId: PROJECT_ID, workspace: 'script', currentFolderId: undefined,
    }));
    expect(resumeAgentTurn.mock.calls[0][0].usageBinding.context.projectId).toBe(PROJECT_ID);
  });
});
