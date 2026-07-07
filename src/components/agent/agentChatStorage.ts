/**
 * Browser-local persistence for agent chat draft and per-project active sessions.
 * Pure functions with no React dependencies.
 */

const DRAFT_KEY_PREFIX = 'keco:agent:draft:';
const LAST_CONV_KEY_PREFIX = 'keco:agent:last-conversation:';
const AUTO_EXECUTE_KEY_PREFIX = 'keco:agent:auto-execute:';

function storage(): Storage | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage;
}

export function getDraft(userId: string): string {
  const raw = storage()?.getItem(`${DRAFT_KEY_PREFIX}${userId}`);
  return raw ?? '';
}

export function setDraft(userId: string, text: string): void {
  storage()?.setItem(`${DRAFT_KEY_PREFIX}${userId}`, text);
}

export function clearDraft(userId: string): void {
  storage()?.removeItem(`${DRAFT_KEY_PREFIX}${userId}`);
}

export function getLastConversationMap(userId: string): Record<string, string> {
  const raw = storage()?.getItem(`${LAST_CONV_KEY_PREFIX}${userId}`);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, string>;
    }
  } catch {
    // ignore corrupt data
  }
  return {};
}

export function setLastConversation(userId: string, projectId: string, conversationId: string): void {
  const map = getLastConversationMap(userId);
  map[projectId] = conversationId;
  storage()?.setItem(`${LAST_CONV_KEY_PREFIX}${userId}`, JSON.stringify(map));
}

export function clearLastConversation(userId: string, projectId: string): void {
  const map = getLastConversationMap(userId);
  delete map[projectId];
  storage()?.setItem(`${LAST_CONV_KEY_PREFIX}${userId}`, JSON.stringify(map));
}

export function clearLastConversationById(userId: string, conversationId: string): void {
  const map = getLastConversationMap(userId);
  let changed = false;
  for (const [projectId, id] of Object.entries(map)) {
    if (id === conversationId) {
      delete map[projectId];
      changed = true;
    }
  }
  if (changed) {
    storage()?.setItem(`${LAST_CONV_KEY_PREFIX}${userId}`, JSON.stringify(map));
  }
}

/** User preference for new conversations. Defaults to false (manual confirm). */
export function getAutoExecutePreference(userId: string): boolean {
  const raw = storage()?.getItem(`${AUTO_EXECUTE_KEY_PREFIX}${userId}`);
  return raw === 'true';
}

export function setAutoExecutePreference(userId: string, autoExecute: boolean): void {
  storage()?.setItem(`${AUTO_EXECUTE_KEY_PREFIX}${userId}`, autoExecute ? 'true' : 'false');
}
