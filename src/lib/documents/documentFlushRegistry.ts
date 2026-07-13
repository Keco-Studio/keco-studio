/**
 * Allows the sidebar (or any navigator) to await a flush of the currently
 * open document editor before changing routes. Soft navigation often unmounts
 * the editor before a debounced save runs, which dropped unsaved Markdown.
 */

export type DocumentFlushHandler = () => Promise<void>;

let activeFlush: DocumentFlushHandler | null = null;

export function registerDocumentFlushHandler(
  handler: DocumentFlushHandler
): () => void {
  activeFlush = handler;
  return () => {
    if (activeFlush === handler) {
      activeFlush = null;
    }
  };
}

/**
 * Awaitable flush of whatever document editor is currently mounted.
 * Returns true when there is nothing to flush or the flush succeeded, and false
 * when the flush FAILED. Callers should NOT navigate away on a false result, so
 * unsaved edits are not silently lost.
 */
export async function flushOpenDocumentEditor(): Promise<boolean> {
  const handler = activeFlush;
  if (!handler) return true;
  try {
    await handler();
    return true;
  } catch (err) {
    console.error('[documentFlush] flush before navigation failed', err);
    return false;
  }
}
