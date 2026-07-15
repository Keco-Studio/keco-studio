import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  AgentTool,
  ResumeInput,
  SSEEvent,
  ToolContext,
  ToolResult,
} from '@/lib/agent/types';

const loadPendingAction = jest.fn();
const markPendingAction = jest.fn();
const deletePendingAction = jest.fn();
const resolveTool = jest.fn();
const getConversation = jest.fn();
const executeImport = jest.fn<Promise<ToolResult>, [ToolResult, unknown, ToolContext]>();

jest.mock('@/lib/agent/confirmation', () => ({
  loadPendingAction,
  markPendingAction,
  deletePendingAction,
  savePendingAction: jest.fn(),
}));
jest.mock('@/lib/agent/conversation-store', () => ({
  getConversation,
  loadConversationHistory: jest.fn(),
  saveMessage: jest.fn(),
}));
jest.mock('@/lib/agent/tools', () => ({
  allTools: [],
  getToolsForLlmAsync: jest.fn(),
  resolveTool,
}));
jest.mock('@/lib/agent/trace-store', () => ({
  TurnTraceCollector: jest.fn(),
  loadTraceCollector: jest.fn().mockResolvedValue(undefined),
  persistAgentTrace: jest.fn(),
}));

import { resumeAgentTurn } from '@/lib/agent/core';

const PROJECT_ID = '22222222-2222-4222-8222-222222222222';

const resolvedTool: AgentTool = {
  name: 'propose_document_edit',
  description: 'Test document edit tool',
  category: 'write',
  confirmationMode: 'post_preview',
  requiredPermission: 'editor',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  execute: jest.fn(),
  executeImport,
};

function toolContext(userRole: ToolContext['userRole']): ToolContext {
  return {
    projectId: PROJECT_ID,
    userId: '33333333-3333-4333-8333-333333333333',
    conversationId: '44444444-4444-4444-8444-444444444444',
    userRole,
    supabase: {} as SupabaseClient,
  };
}

function resumeInput(userRole: ToolContext['userRole'] = 'editor'): ResumeInput {
  return {
    actionId: 'action-1',
    decision: 'approve',
    toolContext: toolContext(userRole),
    conversationMeta: {},
  };
}

async function nextToolResult(input: ResumeInput): Promise<Extract<SSEEvent, { type: 'tool_result' }>> {
  const iterator = resumeAgentTurn(input);
  try {
    while (true) {
      const next = await iterator.next();
      if (next.done) throw new Error('resume ended without a tool_result event');
      if (next.value.type === 'tool_result') return next.value;
    }
  } finally {
    await iterator.return(undefined);
  }
}

async function eventsThroughToolResult(input: ResumeInput): Promise<SSEEvent[]> {
  const events: SSEEvent[] = [];
  const iterator = resumeAgentTurn(input);
  try {
    while (true) {
      const next = await iterator.next();
      if (next.done) throw new Error('resume ended without a tool_result event');
      events.push(next.value);
      if (next.value.type === 'tool_result') return events;
    }
  } finally {
    await iterator.return(undefined);
  }
}

describe('resumeAgentTurn confirmation integrity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getConversation.mockResolvedValue({ meta: {} });
    resolveTool.mockReturnValue(resolvedTool);
    loadPendingAction.mockResolvedValue({
      conversationId: '44444444-4444-4444-8444-444444444444',
      toolName: resolvedTool.name,
      args: { documentId: '11111111-1111-4111-8111-111111111111' },
      confirmationMode: 'post_preview',
      suspendedState: {
        messages: [{ role: 'user', content: 'Apply the proposed edit.' }],
        pendingToolCall: {
          id: 'call-1',
          type: 'function',
          function: { name: resolvedTool.name, arguments: '{}' },
        },
        toolResult: { success: true, data: { type: 'document_edit' } },
      },
    });
  });

  it('emits explicit success metadata after a confirmed edit succeeds', async () => {
    executeImport.mockResolvedValue({
      success: true,
      displayHint: 'text',
      data: { documentId: '11111111-1111-4111-8111-111111111111' },
    });

    await expect(nextToolResult(resumeInput())).resolves.toMatchObject({
      type: 'tool_result',
      tool: resolvedTool.name,
      success: true,
    });
  });

  it('emits explicit failure metadata after a confirmed edit becomes stale', async () => {
    executeImport.mockResolvedValue({
      success: false,
      error: 'The document changed after this edit was proposed.',
    });

    await expect(nextToolResult(resumeInput())).resolves.toMatchObject({
      type: 'tool_result',
      tool: resolvedTool.name,
      success: false,
      error: 'The document changed after this edit was proposed.',
    });
  });

  it('re-checks the resolved tool permission against the current caller role', async () => {
    executeImport.mockResolvedValue({ success: true, data: {} });

    const events = await eventsThroughToolResult(resumeInput('viewer'));

    expect(events.map((event) => event.type)).toEqual([
      'tool_call_start',
      'tool_call_end',
      'tool_result',
    ]);
    expect(events.at(-1)).toMatchObject({
      type: 'tool_result',
      success: false,
      error: 'Viewer role cannot perform write operations.',
    });
    expect(executeImport).not.toHaveBeenCalled();
  });
});
