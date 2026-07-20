/**
 * Conversation meta resolution and confirmation gating helpers.
 */

import type {
  AgentTool,
  ConversationMeta,
  ConversationScope,
  DocumentTableExportContext,
  ToolContext,
  ToolResult,
} from './types';

/**
 * Normalize raw DB meta to a resolved autoExecute flag (default false) and pass
 * through the bound scope verbatim (absent on legacy rows).
 */
export function resolveConversationMeta(
  raw: ConversationMeta | null | undefined
): ConversationMeta {
  const autoExecute =
    raw?.autoExecute === false
      ? false
      : raw?.autoExecute === true || raw?.skipConfirmation === true
      ? true
      : false;
  const resolved: ConversationMeta = { autoExecute };
  if (raw?.scope) resolved.scope = raw.scope;
  if (raw?.documentExport) resolved.documentExport = raw.documentExport;
  return resolved;
}

/** Whether the ReAct loop should pause for user confirmation before completing a write. */
export function needsConfirmation(tool: AgentTool, meta: ConversationMeta): boolean {
  const resolved = resolveConversationMeta(meta);
  if (tool.category === 'read') return false;
  if (tool.confirmationMode === 'meta') return true;
  if (tool.confirmationPolicy === 'always') return true;
  if (tool.confirmationRequired === false) return false;
  if (tool.confirmationPolicy === undefined && tool.confirmationMode === 'post_preview') return true;
  if (resolved.autoExecute === true) return false;
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

/**
 * Build meta for persisting. Writes autoExecute always and immutable bindings
 * when provided. Mode-change callers must merge rather than overwrite them.
 */
export function metaForSave(
  autoExecute: boolean,
  scope?: ConversationScope,
  documentExport?: DocumentTableExportContext
): ConversationMeta {
  return {
    autoExecute,
    ...(scope ? { scope } : {}),
    ...(documentExport ? { documentExport } : {}),
  };
}
