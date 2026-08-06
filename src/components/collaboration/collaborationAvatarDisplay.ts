export function prependLocalUserWhenCollaborating<T>(
  remoteUsers: readonly T[],
  localUser: T,
): T[] {
  return remoteUsers.length === 0 ? [] : [localUser, ...remoteUsers];
}
