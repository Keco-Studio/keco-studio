/**
 * True when markdown includes an image that the pending (non-Yjs) editor would
 * paint without stored resize width/height.
 */
export function markdownHasImages(markdown: string): boolean {
  if (/!\[[^\]]*\]\([^)\s]+(?:\s+"[^"]*")?\)/.test(markdown)) return true;
  if (/<img\b/i.test(markdown)) return true;
  return false;
}
