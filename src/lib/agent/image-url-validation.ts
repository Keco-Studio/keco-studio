/**
 * Server-side validation for image URLs attached to an agent turn. The agent
 * must only fetch images we produced (uploaded to our public Supabase bucket),
 * so we drop anything that is not an https URL under the configured storage
 * origin. This limits the SSRF / injection surface and bounds request size.
 */

/** Upper bound mirrors MAX_DOC_IMAGES in document-parser. */
export const MAX_IMAGE_URLS = 20;

/**
 * Filter an untrusted `imageUrls` value into a safe list of https URLs that
 * originate from `storageOrigin` (e.g. `NEXT_PUBLIC_SUPABASE_URL`). Returns an
 * empty array for non-array input or when no storage origin is configured.
 */
export function sanitizeImageUrls(input: unknown, storageOrigin: string): string[] {
  if (!Array.isArray(input)) return [];
  const origin = storageOrigin.replace(/\/+$/, '');
  if (!origin) return [];

  const prefix = `${origin}/`;
  const out: string[] = [];
  for (const item of input) {
    if (typeof item !== 'string') continue;
    if (!item.startsWith(prefix)) continue;
    out.push(item);
    if (out.length >= MAX_IMAGE_URLS) break;
  }
  return out;
}
