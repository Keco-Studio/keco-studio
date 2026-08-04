import { prependLocalUserWhenCollaborating } from '@/components/collaboration/collaborationAvatarDisplay';

export type DocumentAvatarUser = {
  id: string;
  name: string;
  color: string;
};

export type DocumentAvatarDisplay = {
  visibleUsers: DocumentAvatarUser[];
  overflowCount: number;
};

export function getDocumentAvatarDisplay(
  localUser: DocumentAvatarUser,
  remoteUsers: readonly DocumentAvatarUser[],
): DocumentAvatarDisplay {
  const users = prependLocalUserWhenCollaborating(remoteUsers, localUser);
  return {
    visibleUsers: users.slice(0, 5),
    overflowCount: Math.max(0, users.length - 5),
  };
}
