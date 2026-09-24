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
import * as toolRegistry from '@/lib/agent/tools';

function input(workspace: AgentTurnInput['toolContext']['workspace'] = 'studio'): AgentTurnInput {
  const query = {
    eq: jest.fn(),
    single: jest.fn().mockResolvedValue({ data: null, error: null }),
    maybeSingle: jest.fn().mockResolvedValue({ data: { id: 'library-1' }, error: null }),
  };
  query.eq.mockReturnValue(query);
  return {
    turnId: 'turn-1',
    conversationId: 'conversation-1',
    userMessage: 'Test the assistant',
    conversationMeta: { autoExecute: true },
    toolContext: {
      userId: 'user-1', conversationId: 'conversation-1', workspace,
      projectId: workspace === 'studio' ? 'project-1' : undefined,
      currentLibraryId: workspace === 'studio' ? 'library-1' : undefined,
      currentLibraryName: workspace === 'studio' ? 'Library' : undefined,
      supabase: { from: jest.fn(() => ({ select: jest.fn(() => query) })) } as unknown as SupabaseClient,
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

  it('constructs one schema for a four-iteration turn and reuses its identity', async () => {
    const builder = jest.spyOn(toolRegistry, 'createTurnToolSchema');
    try {
      streamLlm.mockImplementationOnce(llmToolCall('get_library_schema'))
        .mockImplementationOnce(llmToolCall('get_library_schema'))
        .mockImplementationOnce(llmToolCall('get_library_schema'))
        .mockImplementationOnce(llmFinal);
      executeAgentTool.mockImplementation(async function* () { return { success: true }; });
      await collect(input());
      expect(builder).toHaveBeenCalledTimes(1);
      expect(getLibraryProperties).toHaveBeenCalledTimes(1);
      expect(streamLlm).toHaveBeenCalledTimes(4);
      for (const call of streamLlm.mock.calls) expect(call[1].tools).toBe(streamLlm.mock.calls[0][1].tools);
    } finally { builder.mockRestore(); }
  });

  it.each(['projects', 'script', 'create-map', 'game-design-systems'] as const)
  ('sends a smaller schema payload for %s than the complete registry', (workspace) => {
    const all = toolRegistry.allTools.map((tool) => ({ type: 'function', function: {
      name: tool.name, description: tool.description, parameters: tool.parameters,
    } }));
    expect(JSON.stringify(toolRegistry.getToolsForLlm({ workspace })).length)
      .toBeLessThan(JSON.stringify(all).length);
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
