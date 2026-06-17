/**
 * Inline locally-hosted images as base64 data URLs before sending messages to
 * the LLM.
 *
 * The multimodal model fetches `image_url` parts from the public internet, so a
 * `http://127.0.0.1` / private-network Supabase URL (typical in local dev) is
 * unreachable and rejected ("disallowed url"). For those hosts we fetch the
 * bytes server-side and inline them as a `data:` URL; public URLs are left
 * untouched (cheaper, no re-download, re-sent as a plain URL each turn).
 */

import type { ChatContentPart, ChatMessage } from './types';

/** True for loopback / private-network hosts the model provider cannot reach. */
export function isLocalOrPrivateUrl(url: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return false;
  }
  const host = hostname.replace(/^\[|\]$/g, ''); // strip IPv6 brackets
  if (host === 'localhost' || host === '::1') return true;

  const m = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 127) return true; // loopback
    if (a === 10) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 169 && b === 254) return true; // link-local
  }
  return false;
}

export type ImageFetcher = (
  url: string
) => Promise<{ contentType: string; data: ArrayBuffer } | null>;

const defaultFetcher: ImageFetcher = async (url) => {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || 'image/png';
    const data = await res.arrayBuffer();
    return { contentType, data };
  } catch {
    return null;
  }
};

// Cache resolved data URLs so the same local image is not re-fetched on every
// ReAct iteration / turn within a process.
const cache = new Map<string, string>();

/** Test helper: reset the in-process data-URL cache. */
export function clearInlineCache(): void {
  cache.clear();
}

function toDataUrl(contentType: string, data: ArrayBuffer): string {
  const base64 = Buffer.from(data).toString('base64');
  return `data:${contentType};base64,${base64}`;
}

function hasLocalImage(messages: ChatMessage[]): boolean {
  return messages.some(
    (m) =>
      Array.isArray(m.content) &&
      m.content.some(
        (p) => p.type === 'image_url' && isLocalOrPrivateUrl(p.image_url.url)
      )
  );
}

/**
 * Return a copy of `messages` with local/private `image_url` parts replaced by
 * base64 data URLs. Unreachable local images are dropped (best-effort) so the
 * conversation continues. Returns the input array unchanged when nothing needs
 * inlining.
 */
export async function inlineLocalImages(
  messages: ChatMessage[],
  fetcher: ImageFetcher = defaultFetcher
): Promise<ChatMessage[]> {
  if (!hasLocalImage(messages)) return messages;

  const out: ChatMessage[] = [];
  for (const msg of messages) {
    if (!Array.isArray(msg.content)) {
      out.push(msg);
      continue;
    }
    const parts: ChatContentPart[] = [];
    for (const part of msg.content) {
      if (part.type !== 'image_url' || !isLocalOrPrivateUrl(part.image_url.url)) {
        parts.push(part);
        continue;
      }
      const url = part.image_url.url;
      let dataUrl = cache.get(url);
      if (!dataUrl) {
        const fetched = await fetcher(url);
        if (!fetched) continue; // drop unreachable image
        dataUrl = toDataUrl(fetched.contentType, fetched.data);
        cache.set(url, dataUrl);
      }
      parts.push({ type: 'image_url', image_url: { ...part.image_url, url: dataUrl } });
    }
    out.push({ ...msg, content: parts });
  }
  return out;
}
