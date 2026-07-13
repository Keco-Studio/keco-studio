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

/** Awaitable flush of whatever document editor is currently mounted. */
export async function flushOpenDocumentEditor(): Promise<void> {
  const handler = activeFlush;
  if (!handler) return;
  try {
    await handler();
  } catch (err) {
    console.error('[documentFlush] flush before navigation failed', err);
  }
}
