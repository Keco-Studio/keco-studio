/**
 * Frontend chat message model. Mirrors the SSE event protocol from the agent
 * core but is shaped for rendering (one visual item per array entry).
 */

import type { AgentSelectionContext } from '@/lib/agent/selection-context';
import type { AgentNavigationDestination, AgentWorkspace, DocumentTableExportContext } from '@/lib/agent/types';
import type { GameDesignRuleEvidence } from '@/lib/game-design-system/agentEvidence';
export type { AgentInvalidation } from '@/lib/agent/types';

export function parseAgentNavigationDestination(value: unknown): AgentNavigationDestination | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const destination = value as Record<string, unknown>;
  if (destination.kind !== 'project' || typeof destination.projectId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(destination.projectId)) return null;
  return { kind: 'project', projectId: destination.projectId };
}

export type ChatItemRole = 'user' | 'assistant' | 'tool' | 'error' | 'confirmation';

export type ToolCallStatus = 'running' | 'success' | 'failure';

export interface ToolCallView {
  tool: string;
  args?: string;
  status: ToolCallStatus;
  progressMessage?: string;
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
  /** Distinguishes document/image chips from selected-data chips. */
  kind?: 'file' | 'image' | 'selection';
  /** Original file name shown as a chip in the user bubble. */
  fileName: string;
  /** When set, render an image thumbnail (public URL) instead of a file chip. */
  imageUrl?: string;
}

export interface SendOptions {
  imageUrls?: string[];
  selectionContext?: AgentSelectionContext;
  documentExport?: DocumentTableExportContext;
  /** Composer text to restore if the user stops this turn mid-stream. */
  composerDraft?: string;
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
  gameDesignEvidence?: GameDesignRuleEvidence;
}

export interface SendContext {
  userId?: string;
  projectId: string;
  currentDocumentId?: string;
  currentFolderId?: string;
  currentFolderName?: string;
  currentLibraryId?: string;
  currentLibraryName?: string;
  workspace: AgentWorkspace;
}

export interface AgentRuntimeScope {
  userId?: string;
  workspace: AgentWorkspace;
  projectId?: string;
}
