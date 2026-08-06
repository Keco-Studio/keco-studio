import type { PresenceState } from '@/lib/types/collaboration';

export const DOCUMENT_PRESENCE_UPDATE_EVENT = 'document-presence-update';

export type DocumentPresenceUpdateDetail = {
  projectId: string;
  documentId: string;
  presenceUsers: PresenceState[];
};

export function toDocumentPresenceUser(user: {
  id: string;
  name: string;
  color: string;
}): PresenceState {
  return {
    userId: user.id,
    userName: user.name,
    userEmail: '',
    avatarColor: user.color,
    activeCell: null,
    cursorPosition: null,
    lastActivity: new Date().toISOString(),
    connectionStatus: 'online',
  };
}

export function dispatchDocumentPresenceUpdate(
  detail: DocumentPresenceUpdateDetail,
): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(DOCUMENT_PRESENCE_UPDATE_EVENT, { detail }),
  );
}
