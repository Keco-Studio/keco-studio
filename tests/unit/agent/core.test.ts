import type { SupabaseClient } from '@supabase/supabase-js';
import type { AgentTurnInput, SSEEvent, ToolResult } from '@/lib/agent/types';

const getLibraryProperties = jest.fn();
const streamLlm = jest.fn();
const executeAgentTool = jest.fn();
const saveMessage = jest.fn();

jest.mock('@/lib/agent/data-access', () => ({ getLibraryProperties }));
jest.mock('@/lib/agent/llm-client', () => ({ streamLlm }));
jest.mock('@/lib/agent/tool-execution-stream', () => ({ executeAgentTool }));
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

function input(workspace: AgentTurnInput['toolContext']['workspace'] = 'studio'): AgentTurnInput {
  return {
    turnId: 'turn-1',
    conversationId: 'conversation-1',
    userMessage: 'Test the assistant',
    conversationMeta: { autoExecute: true },
    toolContext: {
      userId: 'user-1', conversationId: 'conversation-1', workspace,
      currentLibraryId: workspace === 'studio' ? 'library-1' : undefined,
      currentLibraryName: workspace === 'studio' ? 'Library' : undefined,
      supabase: {} as SupabaseClient,
      userRole: 'admin',
    },
  };
}

function llmToolCall(name: string) {
  return async function* () {
    yield { type: 'tool_call_delta', index: 0, id: 'call-1', name, arguments: '{}' };
    yield { type: 'finish', reason: 'tool_calls' };
  };
}

function llmFinal() {
  return (async function* () {
    yield { type: 'text_delta', content: 'Done.' };
    yield { type: 'finish', reason: 'stop' };
  })();
}

async function collect(inputValue: AgentTurnInput): Promise<SSEEvent[]> {
  const events: SSEEvent[] = [];
  for await (const event of runAgentTurn(inputValue)) events.push(event);
  return events;
}

describe('agent workspace execution and turn schema', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    saveMessage.mockResolvedValue({ id: 'message-1' });
    getLibraryProperties.mockResolvedValue([]);
  });

  it('rejects a fabricated registered Tool without disclosing the registry', async () => {
    streamLlm.mockImplementationOnce(llmToolCall('create_asset'))
      .mockImplementationOnce(llmFinal);

    const events = await collect(input('projects'));
    expect(events).toContainEqual(expect.objectContaining({
      type: 'tool_result', success: false, error: 'TOOL_NOT_AVAILABLE_IN_WORKSPACE',
    }));
    expect(executeAgentTool).not.toHaveBeenCalled();
    expect(JSON.stringify(events)).not.toContain('update_asset');
  });

  it('does not load library fields for a workspace without library write Tools', async () => {
    streamLlm.mockImplementationOnce(llmFinal);
    const accountInput = input('projects');
    accountInput.toolContext.currentLibraryId = 'library-1';

    await collect(accountInput);

    expect(getLibraryProperties).not.toHaveBeenCalled();
  });

  it.each([
    [{ success: true }, 1],
    [{ success: false, schemaChanged: true }, 1],
    [{ success: true, schemaChanged: true }, 2],
  ] as const)('rebuilds only after a successful schema change: %p', async (result, expectedLoads) => {
    streamLlm.mockImplementationOnce(llmToolCall('add_field'))
      .mockImplementationOnce(llmFinal);
    executeAgentTool.mockImplementation(async function* () {
      return result as ToolResult;
    });

    await collect(input());

    expect(streamLlm).toHaveBeenCalledTimes(2);
    expect(getLibraryProperties).toHaveBeenCalledTimes(expectedLoads);
    const firstTools = streamLlm.mock.calls[0][1].tools;
    const nextTools = streamLlm.mock.calls[1][1].tools;
    expect(nextTools === firstTools).toBe(expectedLoads === 1);
  });
});
