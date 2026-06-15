import { describe, expect, it } from '@jest/globals';
import {
  TurnTraceCollector,
  mergeTokenUsage,
  buildTraceRow,
} from '../../../src/lib/agent/trace-store';

describe('mergeTokenUsage', () => {
  it('sums prompt, completion, and total tokens across calls', () => {
    const merged = mergeTokenUsage(
      { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
      { prompt_tokens: 200, completion_tokens: 80, total_tokens: 280 }
    );
    expect(merged).toEqual({
      prompt_tokens: 300,
      completion_tokens: 130,
      total_tokens: 430,
    });
  });
});

describe('TurnTraceCollector', () => {
  it('builds a trace row with llm calls, tool calls, and confirmations', () => {
    const collector = new TurnTraceCollector({
      turnId: 'turn-1',
      userMessage: 'Create a library',
      startedAtMs: 1_000,
    });

    collector.recordLlmCall({
      iteration: 1,
      finishReason: 'tool_calls',
      latencyMs: 120,
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
    collector.recordToolCall({
      tool: 'create_library',
      args: { name: 'Heroes' },
      success: true,
      latencyMs: 40,
    });
    collector.recordConfirmation({
      actionId: 'action-1',
      tool: 'create_library',
      confirmationMode: 'pre_execute',
    });
    collector.recordConfirmationDecision('action-1', 'approved');

    const row = buildTraceRow(collector, {
      conversationId: 'conv-1',
      userId: 'user-1',
      endedAtMs: 1_200,
    });

    expect(row.turn_id).toBe('turn-1');
    expect(row.user_message).toBe('Create a library');
    expect(row.conversation_id).toBe('conv-1');
    expect(row.user_id).toBe('user-1');
    expect(row.total_latency_ms).toBe(200);
    expect(row.llm_calls).toEqual([
      {
        iteration: 1,
        finishReason: 'tool_calls',
        latencyMs: 120,
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      },
    ]);
    expect(row.tool_calls).toEqual([
      {
        tool: 'create_library',
        args: { name: 'Heroes' },
        success: true,
        latencyMs: 40,
      },
    ]);
    expect(row.confirmations).toEqual([
      {
        actionId: 'action-1',
        tool: 'create_library',
        confirmationMode: 'pre_execute',
        decision: 'approved',
      },
    ]);
    expect(row.token_usage).toEqual({
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
    });
  });

  it('restores state from an existing trace row', () => {
    const collector = TurnTraceCollector.fromRow({
      turn_id: 'turn-2',
      user_message: 'Hello',
      llm_calls: [{
        iteration: 1,
        finishReason: 'stop',
        latencyMs: 50,
        usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
      }],
      tool_calls: [],
      confirmations: [],
      token_usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
      created_at: '2026-06-15T00:00:00.000Z',
    });

    collector.recordLlmCall({
      iteration: 2,
      finishReason: 'stop',
      latencyMs: 30,
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });

    const row = buildTraceRow(collector, {
      conversationId: 'conv-2',
      userId: 'user-2',
      endedAtMs: 10_000,
    });

    expect(row.llm_calls).toHaveLength(2);
    expect(row.token_usage).toEqual({
      prompt_tokens: 4,
      completion_tokens: 3,
      total_tokens: 7,
    });
  });
});
