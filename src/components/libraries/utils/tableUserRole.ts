export type TableUserRole = 'admin' | 'editor' | 'viewer' | null;

export function resolveTableUserRole(
  pageRole: TableUserRole | undefined,
  fallbackRole: TableUserRole,
): TableUserRole {
  return pageRole ?? fallbackRole;
}
