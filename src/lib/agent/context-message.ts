/**
 * Inject the user's current page context into the LLM turn without polluting
 * the persisted user message in the DB.
 */

import type { ToolContext } from './types';

const CONTEXT_PREFIX_PATTERN = /^\[User is viewing:[\s\S]*?\]\n/;

/**
 * Remove a previously injected `[User is viewing: ...]` prefix so the raw user
 * message can be recovered and re-augmented with fresh page context. Safe to
 * call on messages that were never augmented.
 */
export function stripContextAugmentation(userMessage: string): string {
  return userMessage.replace(CONTEXT_PREFIX_PATTERN, '');
}

export function augmentUserMessageForLlm(userMessage: string, ctx: ToolContext): string {
  const hasPageContext =
    ctx.currentLibraryName ||
    ctx.currentLibraryId ||
    ctx.currentSectionName ||
    ctx.currentFolderName;

  if (!hasPageContext) {
    return userMessage;
  }

  const hints: string[] = [];
  if (ctx.currentLibraryName) {
    hints.push(`active library "${ctx.currentLibraryName}"`);
  } else if (ctx.currentLibraryId) {
    hints.push(`active library (id: ${ctx.currentLibraryId})`);
  }
  if (ctx.currentSectionName) {
    hints.push(`active section tab "${ctx.currentSectionName}"`);
  }
  if (ctx.currentFolderName) {
    hints.push(`folder "${ctx.currentFolderName}"`);
  }

  return `[User is viewing: ${hints.join(', ')}. Use this library/section by default in tool calls — do not ask which library unless they name a different one.]\n${userMessage}`;
}
