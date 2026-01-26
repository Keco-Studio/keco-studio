import { useState, useEffect } from 'react';

export type UserRole = 'admin' | 'editor' | 'viewer' | null;

/**
 * useUserRole - 获取当前用户在项目中的角色（用于权限控制）
 *
 * - 从 /api/projects/:projectId/role 拉取
 * - 依赖 projectId 与 supabase（session）
 */
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
