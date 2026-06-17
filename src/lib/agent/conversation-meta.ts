/**
 * Conversation meta resolution and confirmation gating helpers.
 */

import type { AgentTool, ConversationMeta, ToolContext, ToolResult } from './types';

/** Normalize raw DB meta to a resolved autoExecute flag (default true). */
export function resolveConversationMeta(
  raw: ConversationMeta | null | undefined
): ConversationMeta {
  if (raw?.autoExecute === false) return { autoExecute: false };
  if (raw?.autoExecute === true || raw?.skipConfirmation === true) return { autoExecute: true };
  return { autoExecute: true };
}

/** Whether the ReAct loop should pause for user confirmation before completing a write. */
export function needsConfirmation(tool: AgentTool, meta: ConversationMeta): boolean {
  const resolved = resolveConversationMeta(meta);
  if (tool.category === 'read') return false;
  if (resolved.autoExecute === true) return false;
  if (tool.confirmationMode === 'post_preview' || tool.confirmationMode === 'meta') return true;
  if (tool.confirmationMode === 'pre_execute' && meta.skipConfirmation) return false;
  return true;
}

export interface PostPreviewExecution {
  previewResult: ToolResult;
  importResult?: ToolResult;
  finalResult: ToolResult;
}

/** Run preview + import phases for post_preview tools in auto-execute mode. */
export async function executePostPreviewTool(
  tool: AgentTool,
  params: Record<string, unknown>,
  ctx: ToolContext
): Promise<PostPreviewExecution> {
  const previewResult = await tool.execute(params, ctx);
  if (!previewResult.success) {
    return { previewResult, finalResult: previewResult };
  }
  if (!tool.executeImport) {
    return { previewResult, finalResult: previewResult };
  }
  const importResult = await tool.executeImport(previewResult, params, ctx);
  return { previewResult, importResult, finalResult: importResult };
}

/** Build meta for persisting after a mode change (writes autoExecute only). */
export function metaForSave(autoExecute: boolean): ConversationMeta {
  return { autoExecute };
}
