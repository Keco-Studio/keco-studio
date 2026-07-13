'use client';

import { useProjectRoleQuery } from '@/lib/hooks/useProjectRoleQuery';

export function useSidebarProjectRole(
  currentProjectId: string | null,
  userId: string | null | undefined
) {
  const roleQuery = useProjectRoleQuery(currentProjectId, userId);
  return {
    userRole: roleQuery.data?.role ?? null,
    isProjectOwner: roleQuery.data?.isOwner ?? false,
    refetchUserRole: roleQuery.refetch,
  };
}
