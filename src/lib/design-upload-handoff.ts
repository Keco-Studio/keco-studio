/**
 * Hand-off store for the design-upload flow.
 *
 * The upload page parses a document into a (potentially large) chat message and
 * stashes it in sessionStorage, then navigates to a dashboard page where the
 * always-mounted ChatPanel picks it up and sends it to the agent. sessionStorage
 * is used instead of the URL because the document text can exceed URL limits.
 */

const KEY_PREFIX = 'design-upload:';
const KEY_SUFFIX = ':pending-message';

/** Max age before a stashed message is considered stale and ignored. */
const MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes

export interface DesignUploadHandoff {
  message: string;
  fileName: string;
  /** Durable project document created from the uploaded source. */
  documentId?: string;
  /** Public image URLs (Supabase storage) extracted from the document, if any. */
  imageUrls?: string[];
  timestamp: number;
}

/** Window event dispatched right after a hand-off is saved, so the (already
 * mounted) ChatPanel can react even when the project id does not change. */
export const DESIGN_UPLOAD_EVENT = 'design-upload:submitted';

function handoffKey(projectId: string): string {
  return `${KEY_PREFIX}${projectId}${KEY_SUFFIX}`;
}

function readHandoff(projectId: string, remove: boolean): DesignUploadHandoff | null {
  if (typeof window === 'undefined' || !projectId) return null;
  const key = handoffKey(projectId);
  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(key);
    if (raw && remove) window.sessionStorage.removeItem(key);
  } catch {
    return null;
  }
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as DesignUploadHandoff;
    if (!parsed?.message || typeof parsed.message !== 'string') return null;
    if (typeof parsed.timestamp !== 'number' || Date.now() - parsed.timestamp > MAX_AGE_MS) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveDesignHandoff(
  projectId: string,
  payload: Omit<DesignUploadHandoff, 'timestamp'>
): void {
  if (typeof window === 'undefined' || !projectId) return;
  const record: DesignUploadHandoff = { ...payload, timestamp: Date.now() };
  try {
    window.sessionStorage.setItem(handoffKey(projectId), JSON.stringify(record));
  } catch {
    // best-effort: storage may be full or unavailable
  }
}

/**
 * Read and remove the pending hand-off for a project. Returns null when absent,
 * malformed, or older than MAX_AGE_MS.
 */
export function takeDesignHandoff(projectId: string): DesignUploadHandoff | null {
  return readHandoff(projectId, true);
}

/**
 * Check for a pending hand-off without consuming it. Used to suppress the normal
 * conversation restore so the design-upload flow can drive a fresh conversation.
 */
export function peekDesignHandoff(projectId: string): DesignUploadHandoff | null {
  return readHandoff(projectId, false);
}
