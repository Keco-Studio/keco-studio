'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSupabase } from '@/lib/SupabaseContext';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidProjectId(projectId: string | null): boolean {
  return !!projectId && UUID_REGEX.test(projectId);
}

/**
 * Fetches and exposes user role and project-owner flag for the current project in the Sidebar.
 * Exposes refetchUserRole for realtime collaborator updates.
 */
export function useSidebarProjectRole(
  currentProjectId: string | null,
  userProfile: { id: string } | null | undefined
) {
  const supabase = useSupabase();
  const [userRole, setUserRole] = useState<'admin' | 'editor' | 'viewer' | null>(null);
  const [isProjectOwner, setIsProjectOwner] = useState(false);

  const fetchUserRole = useCallback(async () => {
    if (!isValidProjectId(currentProjectId) || !userProfile) {
      setUserRole(null);
      setIsProjectOwner(false);
      return;
    }

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setUserRole(null);
        setIsProjectOwner(false);
        return;
      }

      const roleResponse = await fetch(`/api/projects/${currentProjectId}/role`, {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (roleResponse.ok) {
        const roleResult = await roleResponse.json();
        setUserRole(roleResult.role || null);
        setIsProjectOwner(roleResult.isOwner || false);
      } else {
        setUserRole(null);
        setIsProjectOwner(false);
      }
    } catch (error) {
      console.error('[Sidebar] Error fetching user role:', error);
      setUserRole(null);
      setIsProjectOwner(false);
    }
  }, [currentProjectId, userProfile, supabase]);

  useEffect(() => {
    fetchUserRole();
  }, [fetchUserRole]);

  return { userRole, isProjectOwner, refetchUserRole: fetchUserRole };
}
