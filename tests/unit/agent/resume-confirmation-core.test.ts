import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  AgentTool,
  ResumeInput,
  SSEEvent,
  ToolContext,
  ToolResult,
} from '@/lib/agent/types';

const loadPendingAction = jest.fn();
const consumePendingAction = jest.fn();
const savePendingAction = jest.fn();
const resolveTool = jest.fn();
const getToolsForLlmAsync = jest.fn();
const getConversation = jest.fn();
const loadConversationHistory = jest.fn();
const saveMessage = jest.fn();
const streamLlm = jest.fn();
const executeAgentTool = jest.fn();
const executeImport = jest.fn<Promise<ToolResult>, [ToolResult, unknown, ToolContext]>();

jest.mock('@/lib/agent/confirmation', () => ({
  loadPendingAction,
  consumePendingAction,
  savePendingAction,
}));
jest.mock('@/lib/agent/conversation-store', () => ({
  getConversation,
  loadConversationHistory,
  saveMessage,
  sanitizeMessagesForLlm: (messages: unknown[]) => messages,
}));
jest.mock('@/lib/agent/tools', () => ({
  allTools: [],
  getToolsForLlmAsync,
  resolveTool,
}));
jest.mock('@/lib/agent/llm-client', () => ({ streamLlm }));
jest.mock('@/lib/agent/tool-execution-stream', () => ({ executeAgentTool }));
jest.mock('@/lib/agent/embedding-config', () => ({ AGENT_RETRIEVAL_ENABLED: false }));
jest.mock('@/lib/agent/trace-store', () => ({
  TurnTraceCollector: jest.fn(() => ({
    turnId: 'turn-1',
    recordLlmCall: jest.fn(),
    recordToolCall: jest.fn(),
    recordConfirmation: jest.fn(),
  })),
  loadTraceCollector: jest.fn().mockResolvedValue(undefined),
  persistAgentTrace: jest.fn(),
}));

import { resumeAgentTurn, runAgentTurn } from '@/lib/agent/core';

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
    consumePendingAction.mockResolvedValue(true);
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
    expect(loadPendingAction).toHaveBeenCalledWith(
      expect.anything(),
      'action-1',
      '33333333-3333-4333-8333-333333333333'
    );
    expect(consumePendingAction).toHaveBeenCalledWith(
      expect.anything(),
      'action-1',
      '33333333-3333-4333-8333-333333333333',
      'approved'
    );
    expect(consumePendingAction.mock.invocationCallOrder[0]).toBeLessThan(
      executeImport.mock.invocationCallOrder[0]
    );
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

  it('does not execute when atomic consumption reports the action was already handled', async () => {
    consumePendingAction.mockResolvedValue(false);

    const events: SSEEvent[] = [];
    for await (const event of resumeAgentTurn(resumeInput())) events.push(event);

    expect(events).toEqual([
      { type: 'error', message: 'This action has expired or was already handled.' },
      { type: 'done' },
    ]);
    expect(executeImport).not.toHaveBeenCalled();
  });

  it('does not replay a same-context signed proposal after the first consumption', async () => {
    consumePendingAction.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    executeImport.mockResolvedValue({ success: true, data: {} });

    await nextToolResult(resumeInput());
    const replayEvents: SSEEvent[] = [];
    for await (const event of resumeAgentTurn(resumeInput())) replayEvents.push(event);

    expect(executeImport).toHaveBeenCalledTimes(1);
    expect(replayEvents).toEqual([
      { type: 'error', message: 'This action has expired or was already handled.' },
      { type: 'done' },
    ]);
  });
});

describe('post-preview confirmation data boundary', () => {
  it('pauses an always-confirm deletion in auto mode without importing it', async () => {
    executeImport.mockClear();
    const deletePreview = {
      type: 'document_delete',
      documentId: '11111111-1111-4111-8111-111111111111',
      projectId: PROJECT_ID,
      name: 'Guide',
      folderName: 'Lore',
      updatedAt: '2026-07-15T00:00:00.000Z',
    };
    const previewResult: ToolResult = {
      success: true,
      data: deletePreview,
      internalData: deletePreview,
      displayHint: 'text',
    };
    const deleteTool: AgentTool = {
      ...resolvedTool,
      name: 'delete_document',
      confirmationPolicy: 'always',
      execute: jest.fn().mockResolvedValue(previewResult),
    };
    resolveTool.mockReturnValue(deleteTool);
    getToolsForLlmAsync.mockResolvedValue([]);
    loadConversationHistory.mockResolvedValue([]);
    saveMessage.mockResolvedValue({ id: 'message-1' });
    executeAgentTool.mockImplementation(async function* () {
      return previewResult;
    });
    streamLlm.mockImplementation(async function* () {
      yield {
        type: 'tool_call_delta',
        index: 0,
        id: 'call-delete',
        name: deleteTool.name,
        arguments: '{"documentId":"11111111-1111-4111-8111-111111111111"}',
      };
      yield { type: 'finish', reason: 'tool_calls' };
    });

    const events: SSEEvent[] = [];
    for await (const event of runAgentTurn({
      conversationId: '44444444-4444-4444-8444-444444444444',
      userMessage: 'Delete the guide.',
      toolContext: toolContext('editor'),
      conversationMeta: { autoExecute: true },
    })) {
      events.push(event);
    }

    expect(events.find((event) => event.type === 'confirmation_request')).toMatchObject({
      tool: 'delete_document',
      confirmationMode: 'post_preview',
      preview: deletePreview,
    });
    expect(executeImport).not.toHaveBeenCalled();
    expect(savePendingAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        toolName: 'delete_document',
        suspendedState: expect.objectContaining({ toolResult: previewResult }),
      }),
      '33333333-3333-4333-8333-333333333333'
    );
  });

  it('persists the signed preview internally while emitting only public preview data', async () => {
    const approvalSignature = 'a'.repeat(64);
    const publicPreview = { type: 'document_edit', proposedMarkdown: '# Public preview' };
    const previewResult: ToolResult = {
      success: true,
      data: publicPreview,
      internalData: { ...publicPreview, approvalSignature },
      displayHint: 'text',
    };
    const previewTool: AgentTool = {
      ...resolvedTool,
      execute: jest.fn().mockResolvedValue(previewResult),
    };
    resolveTool.mockReturnValue(previewTool);
    getToolsForLlmAsync.mockResolvedValue([]);
    loadConversationHistory.mockResolvedValue([]);
    saveMessage.mockResolvedValue({ id: 'message-1' });
    executeAgentTool.mockImplementation(async function* () {
      return previewResult;
    });
    streamLlm.mockImplementation(async function* () {
      yield {
        type: 'tool_call_delta',
        index: 0,
        id: 'call-1',
        name: previewTool.name,
        arguments: '{}',
      };
      yield { type: 'finish', reason: 'tool_calls' };
    });

    const events: SSEEvent[] = [];
    for await (const event of runAgentTurn({
      conversationId: '44444444-4444-4444-8444-444444444444',
      userMessage: 'Apply the edit.',
      toolContext: toolContext('editor'),
      conversationMeta: {},
    })) {
      events.push(event);
    }

    expect(events.find((event) => event.type === 'tool_result')).toMatchObject({
      data: publicPreview,
    });
    expect(events.find((event) => event.type === 'confirmation_request')).toMatchObject({
      preview: publicPreview,
    });
    expect(JSON.stringify(events)).not.toContain(approvalSignature);
    expect(savePendingAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        suspendedState: expect.objectContaining({ toolResult: previewResult }),
      }),
      '33333333-3333-4333-8333-333333333333'
    );
    expect(JSON.stringify(saveMessage.mock.calls)).not.toContain(approvalSignature);
  });
});
