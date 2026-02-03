import { useState, useEffect } from 'react';

export type UserRole = 'admin' | 'editor' | 'viewer' | null;


export function useUserRole(projectId: string | undefined, supabase: any): UserRole {
  const [userRole, setUserRole] = useState<UserRole>(null);

  useEffect(() => {
    const fetchUserRole = async () => {
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

        const roleResponse = await fetch(`/api/projects/${projectId}/role`, {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        });

        if (roleResponse.ok) {
          const roleResult = await roleResponse.json();
          setUserRole(roleResult.role || null);
        } else {
          setUserRole(null);
        }
      } catch (error) {
        console.error('[useUserRole] Error fetching user role:', error);
        setUserRole(null);
      }
    };

    fetchUserRole();
  }, [projectId, supabase]);

  return userRole;
}
