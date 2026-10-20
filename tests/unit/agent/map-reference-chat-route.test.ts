import { NextRequest } from 'next/server';

jest.mock('server-only', () => ({}));

const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PROJECT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CONVERSATION = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SUBMISSION = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const supabase = { from: jest.fn() };
const runAgentTurn = jest.fn();
const getConversation = jest.fn();
const resolveUserRole = jest.fn();
const validateMapReferenceAttachment = jest.fn();

jest.mock('@/lib/auth/route-auth', () => ({
  withAuth: (handler: Function) => (request: NextRequest) =>
    handler(request, undefined, { supabase, user: { id: USER } }),
}));
jest.mock('@/lib/agent/core', () => ({ runAgentTurn }));
jest.mock('@/lib/agent/conversation-store', () => ({ getConversation, getOrCreateConversation: jest.fn() }));
jest.mock('@/lib/agent/permissions', () => ({
  AgentAccessError: class AgentAccessError extends Error {}, resolveUserRole,
}));
jest.mock('@/lib/agent/current-document-context', () => ({ resolveCurrentDocumentContext: jest.fn(async () => ({})) }));
jest.mock('@/lib/agent/sse', () => ({ sseResponse: () => new Response(null) }));
jest.mock('@/lib/server/documentExportSourceService', () => ({ getDocumentExportSource: jest.fn() }));
jest.mock('@/lib/server/documentExportSnapshotSigning', () => ({ verifyDocumentExportSnapshotToken: jest.fn() }));
jest.mock('@/lib/design-message', () => ({ buildDesignMessage: jest.fn() }));
jest.mock('@/lib/agent/map-reference-attachment', () => ({
  MAX_AGENT_MAP_REFERENCE_BYTES: 5 * 1024 * 1024, validateMapReferenceAttachment,
}));

import { POST } from '@/app/api/agent-chat/route';

function multipart(workspace = 'create-map') {
  const form = new FormData();
  form.set('payload', JSON.stringify({ conversationId: CONVERSATION, workspace,
    message: 'Use this layout', mapReferenceSubmissionId: SUBMISSION }));
  form.set('mapReference', new File(['image bytes'], 'layout.png', { type: 'image/png' }));
  return new NextRequest('https://example.test/api/agent-chat', { method: 'POST',
    headers: { 'content-length': '1024' }, body: form });
}

describe('Map reference chat attachment', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getConversation.mockResolvedValue({ id: CONVERSATION, user_id: USER, project_id: PROJECT,
      meta: { scope: { level: 'project', projectId: PROJECT, workspace: 'create-map' } } });
    resolveUserRole.mockResolvedValue('editor');
    validateMapReferenceAttachment.mockResolvedValue({ fileName: 'layout.png',
      mimeType: 'image/png', fileSize: 11, sha256: 'a'.repeat(64),
      normalizedSha256: 'b'.repeat(64), width: 16, height: 16,
      bytes: new Uint8Array([1]), normalizedBytes: new Uint8Array([2]) });
  });

  it('passes only the authenticated multipart Map file into the turn', async () => {
    const response = await POST(multipart());
    expect(response.status).toBe(200);
    expect(validateMapReferenceAttachment).toHaveBeenCalledWith(expect.objectContaining({ name: 'layout.png' }));
    expect(runAgentTurn).toHaveBeenCalledWith(expect.objectContaining({
      mapReferenceSubmissionId: SUBMISSION,
      mapReferenceAttachment: expect.objectContaining({ fileName: 'layout.png' }),
      toolContext: expect.objectContaining({ projectId: PROJECT, workspace: 'create-map' }),
    }));
  });

  it('rejects a fabricated JSON submission without a file', async () => {
    const response = await POST(new NextRequest('https://example.test/api/agent-chat', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ conversationId: CONVERSATION, message: 'Upload by URL',
        mapReferenceSubmissionId: SUBMISSION }),
    }));
    expect(response.status).toBe(400);
    expect(runAgentTurn).not.toHaveBeenCalled();
  });

  it('rejects an attachment in a conversation bound to Studio', async () => {
    getConversation.mockResolvedValueOnce({ id: CONVERSATION, user_id: USER, project_id: PROJECT,
      meta: { scope: { level: 'project', projectId: PROJECT, workspace: 'studio' } } });
    const response = await POST(multipart('create-map'));
    expect(response.status).toBe(403);
    expect(runAgentTurn).not.toHaveBeenCalled();
  });
});
