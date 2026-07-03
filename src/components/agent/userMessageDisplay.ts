/**
 * Derives how a user message should be displayed in the chat. Design-document
 * messages carry the full document body (for the model) but are shown to the
 * user as a compact file chip plus their own instructions.
 *
 * Used by both the live send path and the history loader so the displayed bubble
 * is identical whether the message was just sent or restored after a refresh.
 */

import { parseDesignMessage } from '@/lib/design-message';
import type { AgentSelectionContext } from '@/lib/agent/selection-context';
import type { ChatAttachment } from './types';

export interface UserDisplay {
  text: string;
  attachments?: ChatAttachment[];
}

/** Derive a short, human-readable file name from an image URL. */
function fileNameFromUrl(url: string): string {
  try {
    const path = new URL(url).pathname;
    const last = path.split('/').pop() ?? '';
    return decodeURIComponent(last) || 'image';
  } catch {
    const last = url.split('/').pop() ?? '';
    return last || 'image';
  }
}

export function deriveUserDisplay(
  message: string,
  imageUrls?: string[],
  selectionContext?: AgentSelectionContext
): UserDisplay {
  const selectionAttachments: ChatAttachment[] = selectionContext
    ? [{ kind: 'selection', fileName: selectionContext.selectionLabel }]
    : [];

  const design = parseDesignMessage(message);
  if (design) {
    // Design-document messages keep their file chip; embedded doc images are not
    // shown as thumbnails (there can be many and the chip already conveys it).
    return {
      text: design.instructions ?? '',
      attachments: [{ fileName: design.fileName }, ...selectionAttachments],
    };
  }

  if (imageUrls && imageUrls.length > 0) {
    return {
      text: message,
      attachments: [
        ...selectionAttachments,
        ...imageUrls.map((url) => ({ fileName: fileNameFromUrl(url), imageUrl: url })),
      ],
    };
  }

  if (selectionAttachments.length > 0) {
    return { text: message, attachments: selectionAttachments };
  }

  return { text: message };
}
