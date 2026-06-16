/**
 * Helpers for working with multimodal message content. A `ChatMessage.content`
 * is either a plain string, `null`, or an array of `ChatContentPart` (a text
 * part plus zero or more `image_url` parts). These utilities let the rest of
 * the agent read/rewrite the text portion without dropping image parts.
 */

import type { ChatContentPart, ChatImagePart, ChatMessage } from './types';

type Content = ChatMessage['content'];

/** Read the concatenated text of a message regardless of string/parts shape. */
export function getMessageText(content: Content): string {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  return content
    .filter((part): part is Extract<ChatContentPart, { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)
    .join('');
}

/**
 * Map only the text portion of a message, preserving image parts and ordering.
 *
 * - string content -> the mapped string.
 * - parts content -> the first text part is rewritten in place; if there is no
 *   text part, a new text part is prepended so the mapped text is not lost.
 * - null -> null.
 */
export function mapMessageText(content: Content, fn: (text: string) => string): Content {
  if (content == null) return null;
  if (typeof content === 'string') return fn(content);

  let rewrote = false;
  const next = content.map((part) => {
    if (!rewrote && part.type === 'text') {
      rewrote = true;
      return { type: 'text', text: fn(part.text) } as ChatContentPart;
    }
    return part;
  });
  if (!rewrote) {
    next.unshift({ type: 'text', text: fn('') });
  }
  return next;
}

/**
 * Build the user message content for an LLM turn. With no image URLs the content
 * stays a plain string (text-only path, unchanged behavior); otherwise it
 * becomes a leading text part followed by one `image_url` part per URL.
 */
export function buildUserContent(text: string, imageUrls?: string[]): Content {
  if (!imageUrls || imageUrls.length === 0) return text;
  const imageParts: ChatImagePart[] = imageUrls.map((url) => ({
    type: 'image_url',
    image_url: { url },
  }));
  return [{ type: 'text', text }, ...imageParts];
}
