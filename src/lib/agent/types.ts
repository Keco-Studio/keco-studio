/**
 * Keco-Studio Agent — Core type definitions.
 *
 * Shared between the ReAct loop (core.ts), the tool handlers, the LLM client,
 * and the API routes. Frontend message/SSE types live in
 * src/components/agent/types.ts but mirror the SSEEvent union declared here.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AccessVerificationCache } from '@/lib/services/authorizationService';
import type { AgentSelectionContext } from './selection-context';
import type { StoryPlanProgressEvent as ImportProgressEvent } from '@/lib/story-plan/conversion';

export type UserRole = 'admin' | 'editor' | 'viewer';

/**
 * How a tool's confirmation is handled by the ReAct loop.
 * - pre_execute:  Pause BEFORE execution, confirm args (create/update/delete_asset).
 * - post_preview: Execute a non-mutating step first, show a preview, then confirm
 *                 the mutating step.
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
  currentDocumentId?: string;
  currentDocumentName?: string;
  currentLibraryId?: string;
  currentLibraryName?: string;
  currentSectionName?: string;
  supabase: SupabaseClient;
  userRole: UserRole;
  /** Request-scoped authorization results; a new map is created for every turn. */
  accessCache?: AccessVerificationCache;
  /** Exact persisted user message for tools that must not trust LLM-copied content. */
  authoritativeUserSource?: {
    messageId: string;
    content: string;
  };
}

export type AgentInvalidation =
  | { type: 'library'; id: string }
  | { type: 'documents'; projectId: string; documentId?: string };

export interface ToolResult {
  success: boolean;
  data?: unknown;
  /** Server-only data persisted in suspended state; never emit to UI, LLM, or tool-result events. */
  internalData?: unknown;
  error?: string;
  displayHint?: DisplayHint;
  /** Structured caches the frontend should refresh after a successful write. */
  invalidations?: AgentInvalidation[];
}

export type ConfirmationPreparation =
  | {
      success: true;
      /** Canonical arguments persisted for approval and later execution. */
      args: unknown;
      /** Optional public context shown with the confirmation request. */
      preview?: unknown;
    }
  | {
      success: false;
      error: string;
      data?: unknown;
      displayHint?: DisplayHint;
    };

export interface AgentTool {
  name: string;
  description: string;
  parameters: JSONSchema;
  category: 'read' | 'write';
  confirmationMode: ConfirmationMode;
  /** Whether confirmation follows conversation mode or is mandatory. */
  confirmationPolicy?: 'mode' | 'always';
  /** False when the tool's validated operation is itself the user-requested action. */
  confirmationRequired?: boolean;
  requiredPermission?: 'editor' | 'admin';
  /** Resolve and seal approval-critical arguments before a pre-execute pause. */
  prepareConfirmation?: (
    params: unknown,
    ctx: ToolContext
  ) => Promise<ConfirmationPreparation>;
  execute: (params: unknown, ctx: ToolContext) => Promise<ToolResult>;
  executeStream?: (
    params: unknown,
    ctx: ToolContext
  ) => AsyncGenerator<ImportProgressEvent, ToolResult>;
  /**
   * Optional second phase for post_preview tools. Called by the ReAct loop in
   * auto-execute mode after preview, and by the /confirm resume handler after approval.
   */
  executeImport?: (toolResult: ToolResult, params: unknown, ctx: ToolContext) => Promise<ToolResult>;
}

/**
 * Data-range level a conversation is bound to, snapshotted at creation time
 * from the user's live navigation (coarse -> fine).
 */
export type ScopeLevel = 'global' | 'project' | 'folder' | 'table';

/**
 * The frozen data range a conversation operates on. Snapshotted once when the
 * conversation is created and used as the authoritative source on every turn,
 * so the agent never drifts with the user's live navigation.
 *
 * `*Name` fields are display snapshots taken at creation time and may go stale
 * after a rename; the runtime resolves fresh names by id and treats these only
 * as fallback / list-badge hints.
 */
export interface ConversationScope {
  level: ScopeLevel;
  projectId?: string;
  folderId?: string;
  folderName?: string;
  libraryId?: string;
  libraryName?: string;
  sectionName?: string;
}

/** Per-conversation settings stored in agent_conversations.meta. */
export interface ConversationMeta {
  /** Default true for new conversations. When true, all write tools skip confirmation. */
  autoExecute?: boolean;

  /** @deprecated Read as autoExecute=true if set. Do not write on new saves. */
  skipConfirmation?: boolean;

  /** Frozen data range bound at conversation creation. Absent on legacy rows. */
  scope?: ConversationScope;
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
  | { type: 'tool_progress'; tool: string; progress: ImportProgressEvent }
  | { type: 'tool_result'; tool: string; data: unknown; displayHint?: DisplayHint; success?: boolean; error?: string }
  | { type: 'confirmation_request'; actionId: string; tool: string; args: unknown; confirmationMode: ConfirmationMode; preview?: unknown }
  | { type: 'cache_invalidated'; invalidations: AgentInvalidation[]; paths?: string[] }
  | { type: 'done' }
  | { type: 'error'; message: string };

/** Suspended ReAct loop state stored in agent_pending_actions.suspended_state. */
export interface SuspendedState {
  messages: ChatMessage[];
  pendingToolCall: ToolCall;
  toolResult?: ToolResult;
  /** Links confirmation resume to the same agent_traces row. */
  turnId?: string;
  /** The next ReAct loop iteration to run when resuming this suspended turn. */
  nextIteration?: number;
  /** Cumulative provider-reported token total for this turn at suspension time. */
  tokenUsageTotal?: number;
}

export interface AgentTurnInput {
  conversationId: string;
  userMessage: string;
  signal?: AbortSignal;
  /** Public image URLs (Supabase storage) attached to this user turn, if any. */
  imageUrls?: string[];
  /** Explicit selected table data attached to this user turn only. */
  selectionContext?: AgentSelectionContext;
  toolContext: ToolContext;
  conversationMeta: ConversationMeta;
}

export interface ResumeInput {
  actionId: string;
  decision: 'approve' | 'reject';
  signal?: AbortSignal;
  toolContext: ToolContext;
  conversationMeta: ConversationMeta;
}
