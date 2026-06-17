/**
 * Public entry for the Keco-Studio agent.
 */

export { runAgentTurn, resumeAgentTurn } from './core';
export { resolveUserRole, isWriteAllowed, AgentAccessError } from './permissions';
export {
  getOrCreateConversation,
  getConversation,
  listConversations,
  deleteConversation,
  getMessages,
  updateConversationMeta,
} from './conversation-store';
export { resolveConversationMeta, needsConfirmation, metaForSave } from './conversation-meta';
export { allTools, getToolsForLlm, resolveTool } from './tools';
export type {
  AgentTool,
  ToolContext,
  ToolResult,
  SSEEvent,
  ConfirmationMode,
  ConversationMeta,
  UserRole,
} from './types';
