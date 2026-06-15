/**
 * Agent Core — ReAct loop with streaming, plus the confirmation resume handler.
 *
 * The loop reloads history from the DB at the start of each turn, streams the
 * LLM response, routes a single tool call per turn, and either executes it
 * directly or suspends to disk for a confirmation round-trip.
 */

import {
  AgentTurnInput,
  ChatMessage,
  ConversationMeta,
  ResumeInput,
  SSEEvent,
  ToolCall,
  ToolContext,
  ToolResult,
  AgentTool,
  TokenUsage,
} from './types';
import { streamLlm } from './llm-client';
import { buildSystemPrompt } from './prompts';
import { getToolsForLlm, resolveTool, allTools } from './tools';
import {
  loadConversationHistory,
  saveMessage,
  getConversation,
} from './conversation-store';
import {
  emptyTurnErrorMessage,
  isEmptyAssistantTurn,
  prepareMessagesForLlm,
} from './tool-result-for-llm';
import { augmentUserMessageForLlm, stripContextAugmentation } from './context-message';
import {
  savePendingAction,
  loadPendingAction,
  markPendingAction,
  deletePendingAction,
} from './confirmation';
import {
  TurnTraceCollector,
  loadTraceCollector,
  persistAgentTrace,
} from './trace-store';

const MAX_ITERATIONS = 50;

/** Cap how much of the raw argument string we echo back to the model on a parse failure. */
const MAX_RAW_ARGS_IN_ERROR = 200;

interface ParsedArgs {
  args: Record<string, unknown>;
  /** Present only when the raw JSON could not be parsed into an object. */
  error?: string;
}

/**
 * Parse the LLM-provided tool arguments.
 *
 * A malformed / truncated JSON payload must NOT be silently coerced to `{}`:
 * doing so hides the mistake from the model (Zod then rejects the empty object,
 * the model assumes the system is broken, and it eventually fabricates a
 * "done" summary). Instead we surface the parse error so it can be fed back as a
 * tool result and the model can self-correct.
 */
function parseArgs(raw: string): ParsedArgs {
  if (!raw || !raw.trim()) return { args: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return {
      args: {},
      error: `Invalid JSON in tool arguments: ${(e as Error).message}. Received: ${raw.slice(0, MAX_RAW_ARGS_IN_ERROR)}`,
    };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      args: {},
      error: `Tool arguments must be a JSON object. Received: ${raw.slice(0, MAX_RAW_ARGS_IN_ERROR)}`,
    };
  }
  return { args: parsed as Record<string, unknown> };
}

function needsConfirmation(tool: AgentTool, meta: ConversationMeta): boolean {
  // Read tools always execute immediately (spec §3).
  if (tool.category === 'read') return false;
  if (tool.confirmationMode === 'post_preview' || tool.confirmationMode === 'meta') return true;
  if (tool.confirmationMode === 'pre_execute' && meta.skipConfirmation) return false;
  return true;
}

async function buildSystemMessage(ctx: ToolContext): Promise<ChatMessage> {
  let projectName: string | undefined;
  let currentLibraryName = ctx.currentLibraryName;
  let currentFolderName = ctx.currentFolderName;

  try {
    const { data: project } = await ctx.supabase
      .from('projects')
      .select('name')
      .eq('id', ctx.projectId)
      .single();
    projectName = project?.name;
  } catch {
    // best-effort
  }

  if (ctx.currentLibraryId && !currentLibraryName) {
    try {
      const { data: lib } = await ctx.supabase
        .from('libraries')
        .select('name')
        .eq('id', ctx.currentLibraryId)
        .single();
      currentLibraryName = lib?.name ?? currentLibraryName;
    } catch {
      // best-effort
    }
  }

  if (ctx.currentFolderId && !currentFolderName) {
    try {
      const { data: folder } = await ctx.supabase
        .from('folders')
        .select('name')
        .eq('id', ctx.currentFolderId)
        .single();
      currentFolderName = folder?.name ?? currentFolderName;
    } catch {
      // best-effort
    }
  }

  return {
    role: 'system',
    content: buildSystemPrompt({
      projectName,
      projectId: ctx.projectId,
      currentFolderId: ctx.currentFolderId,
      currentFolderName,
      currentLibraryId: ctx.currentLibraryId,
      currentLibraryName,
      currentSectionName: ctx.currentSectionName,
      userRole: ctx.userRole,
    }),
  };
}

/**
 * Re-inject fresh page context into the most recent user message in place.
 * Used on confirmation resume, where the suspended user message may carry a
 * stale `[User is viewing: ...]` prefix from before the user navigated away.
 */
function refreshLastUserContext(messages: ChatMessage[], ctx: ToolContext): void {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== 'user' || typeof msg.content !== 'string') continue;
    messages[i] = {
      ...msg,
      content: augmentUserMessageForLlm(stripContextAugmentation(msg.content), ctx),
    };
    return;
  }
}

/** Permission gate run before any write tool executes. */
function checkToolPermission(tool: AgentTool, ctx: ToolContext): ToolResult | null {
  if (tool.category !== 'write') return null;
  if (ctx.userRole === 'viewer') {
    return { success: false, error: 'Viewer role cannot perform write operations.' };
  }
  if (tool.requiredPermission === 'admin' && ctx.userRole !== 'admin') {
    return { success: false, error: `This operation requires the admin role (current role: ${ctx.userRole}).` };
  }
  return null;
}

async function flushTrace(
  collector: TurnTraceCollector | undefined,
  ctx: ToolContext,
  conversationId: string
): Promise<void> {
  if (!collector) return;
  await persistAgentTrace(ctx.supabase, collector, {
    conversationId,
    userId: ctx.userId,
  });
}

/**
 * Drive the ReAct loop over the working messages array. Used both for a fresh
 * turn and after a confirmation resume (with the tool result already appended).
 */
async function* continueLoop(
  messages: ChatMessage[],
  ctx: ToolContext,
  meta: ConversationMeta,
  conversationId: string,
  startIterations: number,
  trace?: TurnTraceCollector
): AsyncGenerator<SSEEvent> {
  let iterations = startIterations;

  while (iterations++ < MAX_ITERATIONS) {
    let assistantContent = '';
    const toolCallsByIndex = new Map<number, ToolCall>();
    let finishReason = '';
    let llmUsage: TokenUsage | undefined;
    const llmStartMs = Date.now();

    for await (const chunk of streamLlm(prepareMessagesForLlm(messages), { tools: getToolsForLlm() })) {
      if (chunk.type === 'text_delta') {
        assistantContent += chunk.content;
        yield { type: 'text_delta', content: chunk.content };
      } else if (chunk.type === 'reasoning_delta') {
        yield { type: 'reasoning_delta', content: chunk.content };
      } else if (chunk.type === 'tool_call_delta') {
        const existing = toolCallsByIndex.get(chunk.index);
        if (existing) {
          if (chunk.id) existing.id = chunk.id;
          if (chunk.name) existing.function.name = chunk.name;
          if (chunk.arguments) existing.function.arguments += chunk.arguments;
        } else {
          toolCallsByIndex.set(chunk.index, {
            id: chunk.id || `call_${chunk.index}`,
            type: 'function',
            function: { name: chunk.name || '', arguments: chunk.arguments || '' },
          });
        }
      } else if (chunk.type === 'finish') {
        finishReason = chunk.reason;
        llmUsage = chunk.usage;
      }
    }

    trace?.recordLlmCall({
      iteration: iterations,
      finishReason: finishReason || 'unknown',
      latencyMs: Date.now() - llmStartMs,
      usage: llmUsage,
    });

    const toolCalls = Array.from(toolCallsByIndex.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([, v]) => v);

    // Plain text response -> end of turn.
    if (toolCalls.length === 0) {
      if (isEmptyAssistantTurn(assistantContent, toolCalls)) {
        yield { type: 'error', message: emptyTurnErrorMessage(finishReason) };
        yield { type: 'done' };
        return;
      }
      messages.push({ role: 'assistant', content: assistantContent });
      await saveMessage(ctx.supabase, conversationId, { role: 'assistant', content: assistantContent });
      yield { type: 'done' };
      return;
    }

    // v1: exactly one tool call per turn (parallel_tool_calls disabled).
    const call = toolCalls[0];
    const assistantMessage: ChatMessage = {
      role: 'assistant',
      content: assistantContent || '',
      tool_calls: [call],
    };

    const tool = resolveTool(call.function.name);
    const parsed = parseArgs(call.function.arguments);

    // Malformed / truncated tool arguments -> feed the parse error back so the
    // model can re-emit a valid call instead of silently receiving {}.
    if (parsed.error) {
      const errorResult: ToolResult = {
        success: false,
        error: `${parsed.error}. Re-issue the tool call with a complete, valid JSON object for the arguments.`,
      };
      trace?.recordToolCall({
        tool: call.function.name,
        args: { _rawArguments: call.function.arguments },
        success: false,
        error: errorResult.error,
      });
      messages.push(assistantMessage);
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(errorResult) });
      await saveMessage(ctx.supabase, conversationId, assistantMessage);
      await saveMessage(ctx.supabase, conversationId, { role: 'tool', tool_call_id: call.id, content: JSON.stringify(errorResult) });
      yield { type: 'tool_result', tool: call.function.name, data: undefined, displayHint: 'text', success: false, error: errorResult.error };
      continue;
    }

    const parsedArgs = parsed.args;

    // Unknown tool -> feed an error back to the LLM.
    if (!tool) {
      const errorResult: ToolResult = {
        success: false,
        error: `Unknown tool "${call.function.name}". Available: ${allTools.map((t) => t.name).join(', ')}`,
      };
      trace?.recordToolCall({
        tool: call.function.name,
        args: parsedArgs,
        success: false,
        error: errorResult.error,
      });
      messages.push(assistantMessage);
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(errorResult) });
      await saveMessage(ctx.supabase, conversationId, assistantMessage);
      await saveMessage(ctx.supabase, conversationId, { role: 'tool', tool_call_id: call.id, content: JSON.stringify(errorResult) });
      continue;
    }

    // Permission gate.
    const permError = checkToolPermission(tool, ctx);
    if (permError) {
      trace?.recordToolCall({
        tool: tool.name,
        args: parsedArgs,
        success: false,
        error: permError.error,
      });
      messages.push(assistantMessage);
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(permError) });
      await saveMessage(ctx.supabase, conversationId, assistantMessage);
      await saveMessage(ctx.supabase, conversationId, { role: 'tool', tool_call_id: call.id, content: JSON.stringify(permError) });
      yield { type: 'tool_result', tool: tool.name, data: undefined, displayHint: 'text', success: false, error: permError.error };
      continue;
    }

    if (needsConfirmation(tool, meta)) {
      // pre_execute / meta -> pause BEFORE execution.
      if (tool.confirmationMode === 'pre_execute' || tool.confirmationMode === 'meta') {
        const actionId = crypto.randomUUID();
        // Persist assistant text (tool_calls deferred until resume) for display continuity.
        if (assistantContent) {
          await saveMessage(ctx.supabase, conversationId, { role: 'assistant', content: assistantContent });
        }
        await savePendingAction(ctx.supabase, {
          id: actionId,
          conversationId,
          toolName: tool.name,
          args: parsedArgs,
          confirmationMode: tool.confirmationMode,
          suspendedState: {
            messages: [...messages],
            pendingToolCall: call,
            turnId: trace?.turnId,
          },
        });
        trace?.recordConfirmation({
          actionId,
          tool: tool.name,
          confirmationMode: tool.confirmationMode,
        });
        await flushTrace(trace, ctx, conversationId);
        yield {
          type: 'confirmation_request',
          actionId,
          tool: tool.name,
          args: parsedArgs,
          confirmationMode: tool.confirmationMode,
        };
        yield { type: 'done' };
        return;
      }

      // post_preview -> execute the non-mutating step first, then pause for preview.
      if (tool.confirmationMode === 'post_preview') {
        yield { type: 'tool_call_start', tool: tool.name, args: call.function.arguments };
        const previewStartMs = Date.now();
        const result = await tool.execute(parsedArgs, ctx);
        trace?.recordToolCall({
          tool: tool.name,
          args: parsedArgs,
          success: result.success,
          error: result.error,
          latencyMs: Date.now() - previewStartMs,
          phase: 'execute',
        });
        yield { type: 'tool_call_end' };
        if (!result.success) {
          messages.push(assistantMessage);
          messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
          await saveMessage(ctx.supabase, conversationId, assistantMessage);
          await saveMessage(ctx.supabase, conversationId, { role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
          yield { type: 'tool_result', tool: tool.name, data: result.data, displayHint: result.displayHint };
          continue;
        }
        const actionId = crypto.randomUUID();
        if (assistantContent) {
          await saveMessage(ctx.supabase, conversationId, { role: 'assistant', content: assistantContent });
        }
        await savePendingAction(ctx.supabase, {
          id: actionId,
          conversationId,
          toolName: tool.name,
          args: parsedArgs,
          confirmationMode: 'post_preview',
          suspendedState: {
            messages: [...messages],
            pendingToolCall: call,
            toolResult: result,
            turnId: trace?.turnId,
          },
        });
        trace?.recordConfirmation({
          actionId,
          tool: tool.name,
          confirmationMode: 'post_preview',
        });
        await flushTrace(trace, ctx, conversationId);
        yield { type: 'tool_result', tool: tool.name, data: result.data, displayHint: result.displayHint };
        yield {
          type: 'confirmation_request',
          actionId,
          tool: tool.name,
          args: parsedArgs,
          confirmationMode: 'post_preview',
          preview: result.data,
        };
        yield { type: 'done' };
        return;
      }
    }

    // No confirmation needed (read tool, or skipConfirmation for pre_execute).
    yield { type: 'tool_call_start', tool: tool.name, args: call.function.arguments };
    const toolStartMs = Date.now();
    const result = await tool.execute(parsedArgs, ctx);
    trace?.recordToolCall({
      tool: tool.name,
      args: parsedArgs,
      success: result.success,
      error: result.error,
      latencyMs: Date.now() - toolStartMs,
      phase: 'execute',
    });
    yield { type: 'tool_call_end' };
    yield {
      type: 'tool_result',
      tool: tool.name,
      data: result.data,
      displayHint: result.displayHint,
      success: result.success,
      error: result.error,
    };
    if (result.invalidateCache && result.invalidateCache.length > 0) {
      yield { type: 'cache_invalidated', paths: result.invalidateCache };
    }

    messages.push(assistantMessage);
    messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
    await saveMessage(ctx.supabase, conversationId, assistantMessage);
    await saveMessage(ctx.supabase, conversationId, { role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
  }

  yield { type: 'error', message: 'Agent reached maximum iterations.' };
  yield { type: 'done' };
}

/** Run a fresh agent turn from a new user message. */
export async function* runAgentTurn(input: AgentTurnInput): AsyncGenerator<SSEEvent> {
  const { toolContext, conversationId, conversationMeta } = input;
  const trace = new TurnTraceCollector({
    turnId: crypto.randomUUID(),
    userMessage: input.userMessage,
  });

  try {
    const systemMessage = await buildSystemMessage(toolContext);

    const history = await loadConversationHistory(toolContext.supabase, conversationId);
    const llmUserMessage = augmentUserMessageForLlm(input.userMessage, toolContext);
    const messages: ChatMessage[] = [systemMessage, ...history, { role: 'user', content: llmUserMessage }];
    await saveMessage(toolContext.supabase, conversationId, { role: 'user', content: input.userMessage });

    yield* continueLoop(messages, toolContext, conversationMeta, conversationId, 0, trace);
  } finally {
    await flushTrace(trace, toolContext, conversationId);
  }
}

/** Resume a suspended turn after the user approves or rejects a pending action. */
export async function* resumeAgentTurn(input: ResumeInput): AsyncGenerator<SSEEvent> {
  const { toolContext } = input;
  const pending = await loadPendingAction(toolContext.supabase, input.actionId);
  if (!pending) {
    yield { type: 'error', message: 'This action has expired or was already handled.' };
    yield { type: 'done' };
    return;
  }

  const conversationId = pending.conversationId;
  const turnId = pending.suspendedState.turnId;
  const trace = turnId ? await loadTraceCollector(toolContext.supabase, turnId) : undefined;
  trace?.recordConfirmationDecision(
    input.actionId,
    input.decision === 'approve' ? 'approved' : 'rejected'
  );

  try {
    const conversation = await getConversation(toolContext.supabase, conversationId);
    const meta = conversation?.meta ?? input.conversationMeta;

    const systemMessage = await buildSystemMessage(toolContext);
    const { messages: suspendedMessages, pendingToolCall, toolResult: savedResult } = pending.suspendedState;

    // Ensure the working messages start with the current system prompt.
    const messages: ChatMessage[] = suspendedMessages[0]?.role === 'system'
      ? [systemMessage, ...suspendedMessages.slice(1)]
      : [systemMessage, ...suspendedMessages];

    // The suspended turn baked the page context into the last user message at
    // suspend time. The user may have navigated elsewhere before approving, so
    // refresh that injected context from the current ToolContext to avoid the
    // system prompt and the user message disagreeing within the same turn.
    refreshLastUserContext(messages, toolContext);

    const tool = resolveTool(pending.toolName);
    const resumeArgs =
      pending.args && typeof pending.args === 'object' && !Array.isArray(pending.args)
        ? (pending.args as Record<string, unknown>)
        : {};

    let result: ToolResult;

    if (input.decision === 'reject') {
      result = { success: false, error: 'User cancelled this action.' };
    } else if (!tool) {
      result = { success: false, error: `Tool "${pending.toolName}" is no longer available.` };
    } else if (pending.confirmationMode === 'post_preview') {
      if (!tool.executeImport || !savedResult) {
        result = { success: false, error: 'Import data unavailable; please retry.' };
      } else {
        yield { type: 'tool_call_start', tool: tool.name, args: JSON.stringify(pending.args) };
        const toolStartMs = Date.now();
        result = await tool.executeImport(savedResult, pending.args, toolContext);
        trace?.recordToolCall({
          tool: tool.name,
          args: resumeArgs,
          success: result.success,
          error: result.error,
          latencyMs: Date.now() - toolStartMs,
          phase: 'executeImport',
        });
        yield { type: 'tool_call_end' };
      }
    } else {
      // pre_execute or meta
      yield { type: 'tool_call_start', tool: tool.name, args: JSON.stringify(pending.args) };
      const toolStartMs = Date.now();
      result = await tool.execute(pending.args, toolContext);
      trace?.recordToolCall({
        tool: tool.name,
        args: resumeArgs,
        success: result.success,
        error: result.error,
        latencyMs: Date.now() - toolStartMs,
        phase: 'execute',
      });
      yield { type: 'tool_call_end' };
    }

    yield { type: 'tool_result', tool: pending.toolName, data: result.data, displayHint: result.displayHint };
    if (result.invalidateCache && result.invalidateCache.length > 0) {
      yield { type: 'cache_invalidated', paths: result.invalidateCache };
    }

    // Persist assistant+tool_calls only after we have the tool result, so a
    // failed execution never leaves orphan tool_calls in the DB.
    const assistantMessage: ChatMessage = { role: 'assistant', content: '', tool_calls: [pendingToolCall] };
    const toolMessage: ChatMessage = {
      role: 'tool',
      tool_call_id: pendingToolCall.id,
      content: JSON.stringify(result),
    };
    messages.push(assistantMessage);
    messages.push(toolMessage);
    await saveMessage(toolContext.supabase, conversationId, assistantMessage);
    await saveMessage(toolContext.supabase, conversationId, toolMessage);

    await markPendingAction(toolContext.supabase, input.actionId, input.decision === 'approve' ? 'approved' : 'rejected');
    await deletePendingAction(toolContext.supabase, input.actionId);

    // Continue the loop so the LLM can summarize the result.
    yield* continueLoop(messages, toolContext, meta, conversationId, 0, trace);
  } finally {
    await flushTrace(trace, toolContext, conversationId);
  }
}
