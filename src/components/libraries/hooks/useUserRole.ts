import { useState, useEffect, useCallback } from 'react';
import { fetchProjectRoleWithRetry } from '@/lib/utils/fetchProjectRoleWithRetry';

export type UserRole = 'admin' | 'editor' | 'viewer' | null;

export function useUserRole(projectId: string | undefined, supabase: any): UserRole {
  const [userRole, setUserRole] = useState<UserRole>(null);

  const loadRole = useCallback(async () => {
    if (!projectId || !supabase) {
      setUserRole(null);
      return;
    }

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setUserRole(null);
        return;
      }

      const result = await fetchProjectRoleWithRetry(projectId, session.access_token);
      setUserRole(result.role);
    } catch (error) {
      console.error('[useUserRole] Error fetching user role:', error);
      setUserRole(null);
    }
  }, [projectId, supabase]);

  useEffect(() => {
    loadRole();
  }, [loadRole]);

  return userRole;
}
