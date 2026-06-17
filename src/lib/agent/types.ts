/**
 * Keco-Studio Agent — Core type definitions.
 *
 * Shared between the ReAct loop (core.ts), the tool handlers, the LLM client,
 * and the API routes. Frontend message/SSE types live in
 * src/components/agent/types.ts but mirror the SSEEvent union declared here.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type UserRole = 'admin' | 'editor' | 'viewer';

/**
 * How a tool's confirmation is handled by the ReAct loop.
 * - pre_execute:  Pause BEFORE execution, confirm args (create/update/delete_asset).
 * - post_preview: Execute a non-mutating step first, show a preview, then confirm
 *                 the mutating step (import_script).
 * - meta:         Confirm the option change itself (set_conversation_option).
 */
export type ConfirmationMode = 'pre_execute' | 'post_preview' | 'meta';

export type DisplayHint = 'table' | 'text' | 'list' | 'script_preview' | 'skill_preview';

/** Loose JSON Schema type — we only forward this to the LLM verbatim. */
export type JSONSchema = Record<string, unknown>;

export interface ToolContext {
  userId: string;
  projectId: string;
  conversationId: string;
  currentFolderId?: string;
  currentFolderName?: string;
  currentLibraryId?: string;
  currentLibraryName?: string;
  currentSectionName?: string;
  supabase: SupabaseClient;
  userRole: UserRole;
}

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  displayHint?: DisplayHint;
  /** Library ids whose cached data should be refreshed by the frontend after a write. */
  invalidateCache?: string[];
}

export interface AgentTool {
  name: string;
  description: string;
  parameters: JSONSchema;
  category: 'read' | 'write';
  confirmationMode: ConfirmationMode;
  requiredPermission?: 'editor' | 'admin';
  execute: (params: unknown, ctx: ToolContext) => Promise<ToolResult>;
  /**
   * Optional second phase for post_preview tools. The generic ReAct loop never
   * calls this — only the /confirm resume handler does, after the user approves
   * a preview. Receives the toolResult saved during the non-mutating execute().
   */
  executeImport?: (toolResult: ToolResult, params: unknown, ctx: ToolContext) => Promise<ToolResult>;
}

/** Per-conversation settings stored in agent_conversations.meta. */
export interface ConversationMeta {
  /** Only applies to pre_execute tools. post_preview and meta tools ALWAYS confirm. */
  skipConfirmation?: boolean;
}

/** A plain-text segment of a multimodal message. */
export interface ChatTextPart {
  type: 'text';
  text: string;
}

/**
 * An image segment of a multimodal message. The url must be publicly reachable
 * by the model provider (we upload doc images to a public Supabase bucket).
 */
export interface ChatImagePart {
  type: 'image_url';
  image_url: { url: string; detail?: 'low' | 'default' | 'high' };
}

export type ChatContentPart = ChatTextPart | ChatImagePart;

/**
 * OpenAI-compatible chat message used to talk to the LLM and persisted (the
 * text/tool parts) in agent_messages.content.
 *
 * `content` may be a multimodal `ChatContentPart[]` (a leading text part plus
 * `image_url` parts) for user messages that carry design-document images.
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ChatContentPart[] | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ToolCall {
  id: string;
  type?: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: JSONSchema;
  };
}

export interface TokenUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

/** Chunks yielded by the LLM streaming client. */
export type StreamChunk =
  | { type: 'text_delta'; content: string }
  | { type: 'reasoning_delta'; content: string }
  | { type: 'tool_call_delta'; index: number; id?: string; name?: string; arguments?: string }
  | { type: 'finish'; reason: 'stop' | 'tool_calls' | 'length' | string; usage?: TokenUsage };

/** Events streamed over SSE to the ChatPanel. Mirrors §5 of the spec. */
export type SSEEvent =
  | { type: 'text_delta'; content: string }
  | { type: 'reasoning_delta'; content: string }
  | { type: 'tool_call_start'; tool: string; args: string }
  | { type: 'tool_call_end' }
  | { type: 'tool_result'; tool: string; data: unknown; displayHint?: DisplayHint; success?: boolean; error?: string }
  | { type: 'confirmation_request'; actionId: string; tool: string; args: unknown; confirmationMode: ConfirmationMode; preview?: unknown }
  | { type: 'cache_invalidated'; paths: string[] }
  | { type: 'done' }
  | { type: 'error'; message: string };

/** Suspended ReAct loop state stored in agent_pending_actions.suspended_state. */
export interface SuspendedState {
  messages: ChatMessage[];
  pendingToolCall: ToolCall;
  toolResult?: ToolResult;
  /** Links confirmation resume to the same agent_traces row. */
  turnId?: string;
}

export interface AgentTurnInput {
  conversationId: string;
  userMessage: string;
  /** Public image URLs (Supabase storage) attached to this user turn, if any. */
  imageUrls?: string[];
  toolContext: ToolContext;
  conversationMeta: ConversationMeta;
}

export interface ResumeInput {
  actionId: string;
  decision: 'approve' | 'reject';
  toolContext: ToolContext;
  conversationMeta: ConversationMeta;
}
