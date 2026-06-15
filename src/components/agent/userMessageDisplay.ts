/**
 * Derives how a user message should be displayed in the chat. Design-document
 * messages carry the full document body (for the model) but are shown to the
 * user as a compact file chip plus their own instructions.
 *
 * Used by both the live send path and the history loader so the displayed bubble
 * is identical whether the message was just sent or restored after a refresh.
 */

import { parseDesignMessage } from '@/lib/design-message';
import type { ChatAttachment } from './types';

export interface UserDisplay {
  text: string;
  attachments?: ChatAttachment[];
}

export function deriveUserDisplay(message: string): UserDisplay {
  const design = parseDesignMessage(message);
  if (design) {
    return {
      text: design.instructions ?? '',
      attachments: [{ fileName: design.fileName }],
    };
  }
  return { text: message };
}
