/**
 * Shrink tool payloads before they are sent back to the LLM on the next ReAct
 * iteration. Full results are still persisted in agent_messages for the UI.
 */

import { sanitizeMessagesForLlm } from './conversation-store';
import type { ChatMessage, ToolCall, ToolResult } from './types';

const MAX_QUERY_ASSET_ROWS = 30;
const MAX_TOOL_CONTENT_CHARS = 16_000;

/**
 * Max non-system messages kept in the LLM context. Older turns are dropped to
 * stop long conversations from (a) re-feeding stale/truncated tool results,
 * (b) treating early mistakes as confirmed facts, and (c) approaching the
 * model context limit (tail-attention collapse). Full history is still
 * persisted in agent_messages and shown in the UI.
 */
const MAX_HISTORY_MESSAGES = 50;

type QueryAssetsData = {
  libraryName?: string;
  libraryId?: string;
  columns?: string[];
  summary?: unknown;
  rowCount?: number;
  rows?: unknown[];
  nonEmptyCells?: unknown[];
  referenceTargets?: unknown[];
  _llmNote?: string;
};

function toolNameForMessage(messages: ChatMessage[], toolMessage: ChatMessage): string | undefined {
  const toolCallId = toolMessage.tool_call_id;
  if (!toolCallId) return undefined;

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== 'assistant' || !msg.tool_calls) continue;
    const match = msg.tool_calls.find((tc) => tc.id === toolCallId);
    if (match) return match.function.name;
  }
  return undefined;
}

function compactQueryAssetsPayload(result: ToolResult): ToolResult {
  if (!result.success || !result.data || typeof result.data !== 'object') return result;

  const data = result.data as QueryAssetsData;
  const rows = Array.isArray(data.rows) ? data.rows : [];
  if (rows.length <= MAX_QUERY_ASSET_ROWS) return result;

  return {
    ...result,
    data: {
      ...data,
      rows: rows.slice(0, MAX_QUERY_ASSET_ROWS),
      rowCount: data.rowCount ?? rows.length,
      _llmNote: `Showing first ${MAX_QUERY_ASSET_ROWS} of ${rows.length} rows. You MUST tell the user that only the first ${MAX_QUERY_ASSET_ROWS} of ${rows.length} rows are visible to you — never invent, count, or summarize the rows you cannot see. Use nameFilter, rowIndex, or limit to narrow further before claiming a complete answer.`,
    },
  };
}

function compactToolResult(result: ToolResult, toolName?: string): ToolResult {
  if (toolName === 'query_assets') {
    return compactQueryAssetsPayload(result);
  }
  return result;
}

/** True when the model produced neither visible text nor a tool call. */
export function isEmptyAssistantTurn(assistantContent: string, toolCalls: ToolCall[]): boolean {
  return toolCalls.length === 0 && assistantContent.trim().length === 0;
}

export function emptyTurnErrorMessage(finishReason: string): string {
  if (finishReason === 'length') {
    return 'Response hit the token limit. Try a smaller request or ask the agent to proceed step by step.';
  }
  return 'The model returned an empty response after a tool call. Send a follow-up message to continue, or retry your request.';
}

/**
 * Compact a persisted tool message body before it is fed to the LLM.
 */
export function compactToolContentForLlm(content: string, toolName?: string): string {
  let parsed: ToolResult;
  try {
    parsed = JSON.parse(content) as ToolResult;
  } catch {
    if (content.length <= MAX_TOOL_CONTENT_CHARS) return content;
    return `${content.slice(0, MAX_TOOL_CONTENT_CHARS)}...[truncated for LLM context]`;
  }

  const compact = compactToolResult(parsed, toolName);
  let serialized = JSON.stringify(compact);
  if (serialized.length <= MAX_TOOL_CONTENT_CHARS) return serialized;

  if (toolName === 'query_assets' && compact.data && typeof compact.data === 'object') {
    const data = compact.data as QueryAssetsData;
    const minimal: ToolResult = {
      success: compact.success,
      error: compact.error,
      displayHint: compact.displayHint,
      data: {
        libraryName: data.libraryName,
        libraryId: data.libraryId,
        columns: data.columns,
        summary: data.summary,
        rowCount: data.rowCount,
        _llmNote: 'Row payload omitted — result exceeded LLM context budget. You MUST tell the user the row contents could not be loaded and ask them to narrow the query; do NOT fabricate or guess any row values. Re-query with filters.',
      },
    };
    serialized = JSON.stringify(minimal);
    if (serialized.length <= MAX_TOOL_CONTENT_CHARS) return serialized;
  }

  return `${serialized.slice(0, MAX_TOOL_CONTENT_CHARS)}...[truncated for LLM context]`;
}

/**
 * Keep the system message plus the most recent MAX_HISTORY_MESSAGES entries.
 *
 * The window boundary is shifted forward so it never starts on a `tool`
 * message: an orphan tool message (without its preceding assistant tool_calls)
 * is rejected by OpenAI-compatible providers. Sanitization afterwards repairs
 * any assistant tool_calls left without their tool replies.
 */
export function windowMessagesForLlm(messages: ChatMessage[]): ChatMessage[] {
  const hasSystem = messages[0]?.role === 'system';
  const system = hasSystem ? [messages[0]] : [];
  const rest = hasSystem ? messages.slice(1) : messages;

  if (rest.length <= MAX_HISTORY_MESSAGES) return messages;

  let start = rest.length - MAX_HISTORY_MESSAGES;
  // Never begin the window on a tool message orphaned from its assistant call.
  while (start < rest.length && rest[start].role === 'tool') {
    start++;
  }
  return [...system, ...rest.slice(start)];
}

/** Window, sanitize, and compact tool payloads for the LLM request. */
export function prepareMessagesForLlm(messages: ChatMessage[]): ChatMessage[] {
  const windowed = windowMessagesForLlm(messages);
  const sanitized = sanitizeMessagesForLlm(windowed);
  return sanitized.map((msg) => {
    if (msg.role !== 'tool' || typeof msg.content !== 'string') return msg;
    const toolName = toolNameForMessage(sanitized, msg);
    return { ...msg, content: compactToolContentForLlm(msg.content, toolName) };
  });
}
