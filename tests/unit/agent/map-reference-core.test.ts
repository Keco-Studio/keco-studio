import type { SupabaseClient } from '@supabase/supabase-js';
import type { AgentTurnInput, SSEEvent } from '@/lib/agent/types';

const streamLlm = jest.fn();
const saveMessage = jest.fn();

jest.mock('@/lib/agent/llm-client', () => ({ streamLlm }));
jest.mock('@/lib/agent/conversation-store', () => ({
  loadConversationHistory: jest.fn().mockResolvedValue([]),
  getConversation: jest.fn().mockResolvedValue(null),
  saveMessage,
  touchConversation: jest.fn(),
  sanitizeMessagesForLlm: (messages: unknown[]) => messages,
}));
jest.mock('@/lib/agent/embedding-config', () => ({ AGENT_RETRIEVAL_ENABLED: false }));
jest.mock('@/lib/agent/trace-store', () => ({
  TurnTraceCollector: jest.fn().mockImplementation(() => ({
    turnId: 'turn-1', recordLlmCall: jest.fn(), recordToolCall: jest.fn(),
    recordConfirmation: jest.fn(),
  })),
  persistAgentTrace: jest.fn(),
}));

import { runAgentTurn } from '@/lib/agent/core';

const sha256 = 'a'.repeat(64);
const attachment = {
  fileName: 'reference.png', mimeType: 'image/png', fileSize: 3,
  sha256, normalizedSha256: 'b'.repeat(64), width: 12, height: 10,
  bytes: new Uint8Array([1, 2, 3]), normalizedBytes: new Uint8Array([4, 5, 6]),
};

function makeInput(rpc: jest.Mock): AgentTurnInput {
  const query = {
    eq: jest.fn(),
    single: jest.fn().mockResolvedValue({ data: null, error: null }),
    maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
  };
  query.eq.mockReturnValue(query);
  return {
    turnId: 'turn-1', conversationId: 'conversation-1',
    userMessage: 'Use this reference', conversationMeta: { autoExecute: true },
    mapReferenceAttachment: attachment,
    mapReferenceSubmissionId: 'submission-1',
    toolContext: {
      userId: 'user-1', conversationId: 'conversation-1',
      workspace: 'create-map', projectId: 'project-1', userRole: 'admin',
      supabase: { rpc, from: jest.fn(() => ({ select: jest.fn(() => query) })) } as unknown as SupabaseClient,
    },
  };
}

async function collect(input: AgentTurnInput): Promise<SSEEvent[]> {
  const events: SSEEvent[] = [];
  for await (const event of runAgentTurn(input)) events.push(event);
  return events;
}

describe('Map reference turn binding', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    saveMessage.mockResolvedValue({ id: 'message-1' });
    streamLlm.mockImplementation(async function* () {
      yield { type: 'text_delta', content: 'Done.' };
      yield { type: 'finish', reason: 'stop' };
    });
  });

  it('rejects a reused submission before saving or sending the turn to the model', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: false, error: null });

    const events = await collect(makeInput(rpc));

    expect(rpc).toHaveBeenCalledWith('claim_agent_map_reference_submission', {
      p_submission_id: 'submission-1', p_project_id: 'project-1',
      p_conversation_id: 'conversation-1', p_sha256: sha256,
    });
    expect(events).toContainEqual({
      type: 'error', message: 'This Map reference submission was already received or could not be claimed.',
    });
    expect(saveMessage).not.toHaveBeenCalled();
    expect(streamLlm).not.toHaveBeenCalled();
  });

  it('persists attachment metadata and binds the saved user message after claiming', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: true, error: null });

    await collect(makeInput(rpc));

    expect(saveMessage).toHaveBeenCalledWith(expect.anything(), 'conversation-1', {
      role: 'user', content: 'Use this reference',
      map_reference_attachment: {
        fileName: 'reference.png', mimeType: 'image/png', fileSize: 3,
        sha256, normalizedSha256: 'b'.repeat(64), width: 12, height: 10,
      },
      map_reference_submission_id: 'submission-1',
    }, expect.anything());
    expect(rpc).toHaveBeenNthCalledWith(2, 'bind_agent_map_reference_submission', {
      p_submission_id: 'submission-1', p_message_id: 'message-1',
    });
    expect(rpc.mock.invocationCallOrder[0]).toBeLessThan(saveMessage.mock.invocationCallOrder[0]);
    expect(saveMessage.mock.invocationCallOrder[0]).toBeLessThan(rpc.mock.invocationCallOrder[1]);
  });

  it('does not send an unbound attachment to the model', async () => {
    const rpc = jest.fn()
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: false, error: null });

    await expect(collect(makeInput(rpc))).rejects.toThrow(
      'Failed to bind the Map reference submission to its user message.'
    );
    expect(streamLlm).not.toHaveBeenCalled();
  });
});
