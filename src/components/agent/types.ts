/**
 * Frontend chat message model. Mirrors the SSE event protocol from the agent
 * core but is shaped for rendering (one visual item per array entry).
 */

export type ChatItemRole = 'user' | 'assistant' | 'tool' | 'error' | 'confirmation';

export type ToolCallStatus = 'running' | 'success' | 'failure';

export interface ToolCallView {
  tool: string;
  args?: string;
  status: ToolCallStatus;
  data?: unknown;
  displayHint?: string;
  error?: string;
}

export interface ConfirmationView {
  actionId: string;
  tool: string;
  args: unknown;
  confirmationMode: 'pre_execute' | 'post_preview' | 'meta';
  preview?: unknown;
  resolved?: 'approved' | 'rejected';
}

export interface ChatAttachment {
  /** Original file name shown as a chip in the user bubble. */
  fileName: string;
}

export interface ChatItem {
  id: string;
  role: ChatItemRole;
  text?: string;
  /** File chips to render alongside the text (e.g. an uploaded design document). */
  attachments?: ChatAttachment[];
  reasoning?: string;
  /** Wall-clock start of the reasoning stream (first reasoning_delta). */
  reasoningStartedAt?: number;
  /** Set when visible answer text begins after reasoning. */
  reasoningEndedAt?: number;
  toolCall?: ToolCallView;
  confirmation?: ConfirmationView;
  error?: string;
}

export interface SendContext {
  userId?: string;
  projectId: string;
  currentFolderId?: string;
  currentFolderName?: string;
  currentLibraryId?: string;
  currentLibraryName?: string;
  currentSectionName?: string;
}
