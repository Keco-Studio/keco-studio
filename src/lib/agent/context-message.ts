/**
 * Inject the user's current page context into the LLM turn without polluting
 * the persisted user message in the DB.
 */

import { formatSelectionContextForLlm, type AgentSelectionContext } from './selection-context';
import type { ToolContext } from './types';

const PAGE_CONTEXT_PREFIX_PATTERN = /^\[User is viewing:[\s\S]*?\]\n/;
const SELECTION_CONTEXT_PREFIX_PATTERN =
  /^\[User attached selected table data for this message:[\s\S]*?\n\}\n/;

/**
 * Remove a previously injected `[User is viewing: ...]` prefix so the raw user
 * message can be recovered and re-augmented with fresh page context. Safe to
 * call on messages that were never augmented.
 */
export function stripContextAugmentation(userMessage: string): string {
  let stripped = userMessage.replace(PAGE_CONTEXT_PREFIX_PATTERN, '');
  stripped = stripped.replace(SELECTION_CONTEXT_PREFIX_PATTERN, '');
  return stripped;
}

export function augmentUserMessageForLlm(
  userMessage: string,
  ctx: ToolContext,
  selectionContext?: AgentSelectionContext
): string {
  const hasPageContext =
    ctx.currentLibraryName ||
    ctx.currentLibraryId ||
    ctx.currentFolderName ||
    ctx.currentDocumentId;

  if (!hasPageContext && !selectionContext) {
    return userMessage;
  }

  const prefixes: string[] = [];
  if (hasPageContext) {
    const hints: string[] = [];
    if (ctx.currentLibraryName) {
      hints.push(`active library "${ctx.currentLibraryName}"`);
    } else if (ctx.currentLibraryId) {
      hints.push(`active library (id: ${ctx.currentLibraryId})`);
    }
    if (ctx.currentFolderName) {
      hints.push(`folder "${ctx.currentFolderName}"`);
    }
    if (ctx.currentDocumentId) {
      hints.push(
        ctx.currentDocumentName
          ? `current document "${ctx.currentDocumentName}" (id: ${ctx.currentDocumentId})`
          : `current document (id: ${ctx.currentDocumentId})`
      );
    }

    const documentGuidance = ctx.currentDocumentId
      ? ' The current document is the default target, not a locked scope; an explicitly named same-project document overrides it.'
      : '';
    prefixes.push(
      `[User is viewing: ${hints.join(', ')}. Use this library by default in tool calls — do not ask which library unless they name a different one.${documentGuidance}]`
    );
  }

  if (selectionContext) {
    prefixes.push(formatSelectionContextForLlm(selectionContext));
  }

  return `${prefixes.join('\n')}\n${userMessage}`;
}
