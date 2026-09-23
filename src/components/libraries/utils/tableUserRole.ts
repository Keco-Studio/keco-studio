export type TableUserRole = 'admin' | 'editor' | 'viewer' | null;

export function resolveTableUserRole(
  pageRole: TableUserRole | undefined,
  fallbackRole: TableUserRole,
  isProjectOwner = false,
): TableUserRole {
  if (isProjectOwner) return 'admin';
  return pageRole ?? fallbackRole;
}
