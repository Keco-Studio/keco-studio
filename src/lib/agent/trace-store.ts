/**
 * Agent audit trace persistence — one row per user turn in agent_traces.
 *
 * Traces are upserted by turn_id so confirmation suspend/resume can append to
 * the same row across HTTP requests.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ConfirmationMode, TokenUsage } from './types';

export interface LlmCallTrace {
  iteration: number;
  finishReason: string;
  latencyMs: number;
  usage?: TokenUsage;
}

export interface ToolCallTrace {
  tool: string;
  args: Record<string, unknown>;
  success: boolean;
  error?: string;
  latencyMs?: number;
  phase?: 'execute' | 'executeImport' | 'clientCompleted';
}

export interface ConfirmationTrace {
  actionId: string;
  tool: string;
  confirmationMode: ConfirmationMode;
  decision?: 'approved' | 'rejected';
}

export interface AgentTraceRow {
  conversation_id: string;
  user_id: string;
  turn_id: string;
  user_message: string | null;
  llm_calls: LlmCallTrace[];
  tool_calls: ToolCallTrace[];
  confirmations: ConfirmationTrace[];
  total_latency_ms: number;
  token_usage: TokenUsage;
}

interface TraceRowSource {
  turn_id: string;
  user_message?: string | null;
  llm_calls?: LlmCallTrace[] | null;
  tool_calls?: ToolCallTrace[] | null;
  confirmations?: ConfirmationTrace[] | null;
  token_usage?: TokenUsage | null;
  created_at?: string;
}

export function mergeTokenUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    prompt_tokens: (a.prompt_tokens ?? 0) + (b.prompt_tokens ?? 0),
    completion_tokens: (a.completion_tokens ?? 0) + (b.completion_tokens ?? 0),
    total_tokens: (a.total_tokens ?? 0) + (b.total_tokens ?? 0),
  };
}

function sumTokenUsage(calls: LlmCallTrace[]): TokenUsage {
  return calls.reduce(
    (acc, call) => (call.usage ? mergeTokenUsage(acc, call.usage) : acc),
    { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
  );
}

export class TurnTraceCollector {
  readonly turnId: string;
  readonly userMessage: string;
  private readonly startedAtMs: number;
  private llmCalls: LlmCallTrace[] = [];
  private toolCalls: ToolCallTrace[] = [];
  private confirmations: ConfirmationTrace[] = [];

  constructor(params: { turnId: string; userMessage: string; startedAtMs?: number }) {
    this.turnId = params.turnId;
    this.userMessage = params.userMessage;
    this.startedAtMs = params.startedAtMs ?? Date.now();
  }

  static fromRow(row: TraceRowSource): TurnTraceCollector {
    const createdAtMs = row.created_at ? Date.parse(row.created_at) : Date.now();
    const collector = new TurnTraceCollector({
      turnId: row.turn_id,
      userMessage: row.user_message ?? '',
      startedAtMs: Number.isFinite(createdAtMs) ? createdAtMs : Date.now(),
    });
    collector.llmCalls = Array.isArray(row.llm_calls) ? [...row.llm_calls] : [];
    collector.toolCalls = Array.isArray(row.tool_calls) ? [...row.tool_calls] : [];
    collector.confirmations = Array.isArray(row.confirmations) ? [...row.confirmations] : [];
    return collector;
  }

  recordLlmCall(entry: LlmCallTrace): void {
    this.llmCalls.push(entry);
  }

  recordToolCall(entry: ToolCallTrace): void {
    this.toolCalls.push(entry);
  }

  recordConfirmation(entry: Omit<ConfirmationTrace, 'decision'>): void {
    this.confirmations.push({ ...entry });
  }

  recordConfirmationDecision(actionId: string, decision: 'approved' | 'rejected'): void {
    const match = [...this.confirmations].reverse().find((c) => c.actionId === actionId);
    if (match) {
      match.decision = decision;
    }
  }

  getStartedAtMs(): number {
    return this.startedAtMs;
  }

  snapshot(): {
    llmCalls: LlmCallTrace[];
    toolCalls: ToolCallTrace[];
    confirmations: ConfirmationTrace[];
  } {
    return {
      llmCalls: [...this.llmCalls],
      toolCalls: [...this.toolCalls],
      confirmations: [...this.confirmations],
    };
  }
}

export function buildTraceRow(
  collector: TurnTraceCollector,
  params: { conversationId: string; userId: string; endedAtMs?: number }
): AgentTraceRow {
  const { llmCalls, toolCalls, confirmations } = collector.snapshot();
  const endedAtMs = params.endedAtMs ?? Date.now();
  return {
    conversation_id: params.conversationId,
    user_id: params.userId,
    turn_id: collector.turnId,
    user_message: collector.userMessage,
    llm_calls: llmCalls,
    tool_calls: toolCalls,
    confirmations,
    total_latency_ms: Math.max(0, endedAtMs - collector.getStartedAtMs()),
    token_usage: sumTokenUsage(llmCalls),
  };
}

export async function loadTraceCollector(
  supabase: SupabaseClient,
  turnId: string
): Promise<TurnTraceCollector | null> {
  const { data, error } = await supabase
    .from('agent_traces')
    .select('turn_id, user_message, llm_calls, tool_calls, confirmations, token_usage, created_at')
    .eq('turn_id', turnId)
    .maybeSingle();
  if (error || !data) return null;
  return TurnTraceCollector.fromRow(data as TraceRowSource);
}

/** Best-effort upsert — trace failures must not break agent turns. */
export async function persistAgentTrace(
  supabase: SupabaseClient,
  collector: TurnTraceCollector,
  params: { conversationId: string; userId: string }
): Promise<void> {
  const row = buildTraceRow(collector, {
    conversationId: params.conversationId,
    userId: params.userId,
  });

  try {
    const { data: existing, error: selectError } = await supabase
      .from('agent_traces')
      .select('id')
      .eq('turn_id', row.turn_id)
      .maybeSingle();

    if (selectError) {
      console.error('[agent_traces] lookup failed:', selectError.message);
      return;
    }

    if (existing?.id) {
      const { error } = await supabase.from('agent_traces').update(row).eq('turn_id', row.turn_id);
      if (error) console.error('[agent_traces] update failed:', error.message);
      return;
    }

    const { error } = await supabase.from('agent_traces').insert(row);
    if (error) console.error('[agent_traces] insert failed:', error.message);
  } catch (err) {
    console.error('[agent_traces] persist failed:', err);
  }
}
