import type { SupabaseClient } from '@supabase/supabase-js';
import type { AgentTurnInput } from '@/lib/agent/types';

const embedQuery = jest.fn();
const retrieveRelevantChunks = jest.fn();
const saveMessage = jest.fn();
const streamLlm = jest.fn();

jest.mock('@/lib/agent/embedding-config', () => ({ AGENT_RETRIEVAL_ENABLED: true }));
jest.mock('@/lib/agent/embedding-client', () => ({ embedQuery }));
jest.mock('@/lib/agent/embedding-retrieval', () => ({
  retrieveRelevantChunks,
  formatRetrievedContext: () => '',
}));
jest.mock('@/lib/agent/llm-client', () => ({ streamLlm }));
jest.mock('@/lib/agent/conversation-store', () => ({
  loadConversationHistory: jest.fn().mockResolvedValue([]),
  getConversation: jest.fn().mockResolvedValue(null),
  saveMessage,
  touchConversation: jest.fn(),
  sanitizeMessagesForLlm: (messages: unknown[]) => messages,
}));
jest.mock('@/lib/agent/trace-store', () => ({
  TurnTraceCollector: jest.fn().mockImplementation(() => ({
    turnId: 'turn-1', recordLlmCall: jest.fn(), recordToolCall: jest.fn(),
    recordConfirmation: jest.fn(),
  })),
  persistAgentTrace: jest.fn(),
}));

import { runAgentTurn } from '@/lib/agent/core';

describe('account Agent retrieval wiring', () => {
  it('embeds once, retrieves only the current conversation, and indexes the user message', async () => {
    embedQuery.mockResolvedValue([0.1, 0.2]);
    retrieveRelevantChunks.mockResolvedValue([]);
    saveMessage.mockResolvedValue({ id: 'message-1' });
    streamLlm.mockImplementation(async function* () {
      yield { type: 'text_delta', content: 'Done.' };
      yield { type: 'finish', reason: 'stop' };
    });
    const input: AgentTurnInput = {
      turnId: 'turn-1',
      conversationId: 'conversation-1',
      userMessage: 'Remember the latest decision',
      conversationMeta: { autoExecute: true },
      toolContext: {
        userId: 'user-1',
        conversationId: 'conversation-1',
        workspace: 'projects',
        supabase: {} as SupabaseClient,
      },
    };

    for await (const _event of runAgentTurn(input)) { /* consume the turn */ }

    expect(embedQuery).toHaveBeenCalledTimes(1);
    expect(retrieveRelevantChunks).toHaveBeenCalledWith(expect.objectContaining({
      projectId: undefined,
      conversationId: 'conversation-1',
      scopes: ['chat_same_conversation'],
      queryEmbedding: [0.1, 0.2],
    }));
    expect(saveMessage).toHaveBeenCalledWith(
      input.toolContext.supabase,
      'conversation-1',
      expect.objectContaining({ role: 'user' }),
      expect.objectContaining({ projectId: null, userId: 'user-1' }),
    );
  });
});
