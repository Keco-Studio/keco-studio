import { NextRequest } from 'next/server';

jest.mock('server-only', () => ({}));

const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const TURN_ID = 'turn-usage-1';
const authSupabase = { rpc: jest.fn() };
const runAgentTurn = jest.fn();
const resumeAgentTurn = jest.fn();
const getOrCreateConversation = jest.fn();
const getConversation = jest.fn();
const loadPendingAction = jest.fn();
const resolveUserRole = jest.fn();
const resolveCurrentDocumentContext = jest.fn();
const sseResponse = jest.fn(() => new Response(null));
const withAuth = jest.fn(
  (handler: unknown) => async (request: NextRequest, context?: unknown) =>
    (handler as (request: NextRequest, context: unknown, auth: unknown) => Promise<Response>)(
      request,
      context,
      { supabase: authSupabase, user: { id: USER_ID } }
    )
);

jest.mock('@/lib/auth/route-auth', () => ({ withAuth }));
jest.mock('@/lib/agent/core', () => ({ runAgentTurn, resumeAgentTurn }));
jest.mock('@/lib/agent/conversation-store', () => ({ getOrCreateConversation, getConversation }));
jest.mock('@/lib/agent/confirmation', () => ({ loadPendingAction }));
jest.mock('@/lib/agent/permissions', () => ({
  AgentAccessError: class AgentAccessError extends Error {},
  resolveUserRole,
}));
jest.mock('@/lib/agent/sse', () => ({ sseResponse }));
jest.mock('@/lib/agent/current-document-context', () => ({ resolveCurrentDocumentContext }));
jest.mock('@/lib/server/documentExportSourceService', () => ({ getDocumentExportSource: jest.fn() }));
jest.mock('@/lib/server/documentExportSnapshotSigning', () => ({
  verifyDocumentExportSnapshotToken: jest.fn(),
}));
jest.mock('@/lib/design-message', () => ({ buildDesignMessage: jest.fn() }));

import { POST as chatPost } from '@/app/api/agent-chat/route';
import { POST as confirmPost } from '@/app/api/agent-chat/confirm/route';

const conversation = {
  id: 'conversation-1', user_id: USER_ID, project_id: PROJECT_ID, title: null,
  meta: {}, created_at: '2026-09-15T00:00:00.000Z', updated_at: '2026-09-15T00:00:00.000Z',
};

const request = (path: string, body: Record<string, unknown>) => new NextRequest(`https://example.test${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

describe('agent usage route wiring', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getOrCreateConversation.mockResolvedValue(conversation);
    getConversation.mockResolvedValue(conversation);
    resolveUserRole.mockResolvedValue('editor');
    resolveCurrentDocumentContext.mockResolvedValue({});
    loadPendingAction.mockResolvedValue({
      conversationId: conversation.id,
      suspendedState: { turnId: TURN_ID },
    });
  });

  it('creates an authenticated ReAct binding after identity and a new turn are known', async () => {
    await chatPost(request('/api/agent-chat', { projectId: PROJECT_ID, message: 'Hello' }));

    expect(runAgentTurn).toHaveBeenCalledWith(expect.objectContaining({
      turnId: expect.any(String),
      usageBinding: expect.objectContaining({
        context: expect.objectContaining({
          actorUserId: USER_ID, projectId: PROJECT_ID, feature: 'agent_chat', operation: 'react_iteration',
          correlationId: expect.stringMatching(/^agent_turn:/),
        }),
        recorder: expect.any(Function),
      }),
    }));
  });

  it('creates a confirmation binding using the persisted turn identity', async () => {
    await confirmPost(request('/api/agent-chat/confirm', { actionId: 'action-1', decision: 'approve' }));

    expect(resumeAgentTurn).toHaveBeenCalledWith(expect.objectContaining({
      usageBinding: expect.objectContaining({
        context: expect.objectContaining({
          actorUserId: USER_ID, projectId: PROJECT_ID, feature: 'agent_chat',
          operation: 'confirmation_resume', correlationId: `agent_turn:${TURN_ID}`,
        }),
        recorder: expect.any(Function),
      }),
    }));
  });
});
