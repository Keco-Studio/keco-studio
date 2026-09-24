/**
 * Frontend chat message model. Mirrors the SSE event protocol from the agent
 * core but is shaped for rendering (one visual item per array entry).
 */

import type { AgentSelectionContext } from '@/lib/agent/selection-context';
import type { AgentNavigationDestination, AgentWorkspace, DocumentTableExportContext } from '@/lib/agent/types';
import type { GameDesignRuleEvidence } from '@/lib/game-design-system/agentEvidence';
import { z } from 'zod';
export type { AgentInvalidation } from '@/lib/agent/types';

const mapGenerationSchema = z.object({
  assetId: z.string().uuid(),
  revisionId: z.string().uuid().optional(),
  status: z.enum(['planned', 'queued', 'generating', 'ready', 'failed', 'blocked']),
  attemptCount: z.number().int().nonnegative(),
  imageUrl: z.string().max(8192).nullable(),
  lastErrorCode: z.string().max(200).nullable(),
});
const mapToolDataSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('list'), projectId: z.string().uuid(),
    maps: z.array(z.object({ mapId: z.string().uuid(), revisionId: z.string().uuid(), title: z.string().max(160) })).max(50),
    nextCursor: z.string().uuid().nullable(),
  }),
  z.object({
    kind: z.literal('map'), projectId: z.string().uuid(), mapId: z.string().uuid(), revisionId: z.string().uuid(),
    revisionNumber: z.number().int().nonnegative().optional(), saveVersion: z.number().int().nonnegative().optional(),
    plan: z.object({ title: z.string().max(160), summary: z.string().max(500), width: z.number().positive(), height: z.number().positive(), referenceCount: z.number().int().nonnegative() }).optional(),
    generation: mapGenerationSchema.nullable().optional(),
  }),
]);

export function parseMapToolData(value: unknown) {
  const parsed = mapToolDataSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

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
