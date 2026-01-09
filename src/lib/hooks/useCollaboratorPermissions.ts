/**
 * Collaborator Permissions Hook
 * 
 * React hook for checking user's role and permissions in a project.
 * Provides real-time permission checks for UI rendering and action validation.
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSupabase } from '@/lib/SupabaseContext';
import type { CollaboratorRole } from '@/lib/types/collaboration';
import { 
  canUserInviteWithRole, 
  canUserManageCollaborators, 
  canUserEdit 
} from '@/lib/types/collaboration';

/**
 * Hook return type
 */
export type CollaboratorPermissions = {
  role: CollaboratorRole | null;
  isOwner: boolean;
  isAdmin: boolean;
  isEditor: boolean;
  isViewer: boolean;
  canInvite: boolean;
  canInviteAsAdmin: boolean;
  canManageCollaborators: boolean;
  canEdit: boolean;
  canView: boolean;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
};

/**
 * Hook for checking collaborator permissions
 * 
 * @param projectId - Project ID to check permissions for
 * @returns Permissions object with role and capability flags
 * 
 * @example
 * ```typescript
 * function ProjectPage({ projectId }: { projectId: string }) {
 *   const permissions = useCollaboratorPermissions(projectId);
 *   
 *   if (permissions.loading) return <Loading />;
 *   if (permissions.error) return <Error message={permissions.error} />;
 *   
 *   return (
 *     <div>
 *       {permissions.canInvite && <InviteButton />}
 *       {permissions.canManageCollaborators && <ManageCollaboratorsButton />}
 *       {permissions.canEdit ? <EditView /> : <ReadOnlyView />}
 *     </div>
 *   );
 * }
 * ```
 */
export function useCollaboratorPermissions(
  projectId: string | null | undefined
): CollaboratorPermissions {
  const supabase = useSupabase();
  const [role, setRole] = useState<CollaboratorRole | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPermissions = useCallback(async () => {
    if (!projectId) {
      setRole(null);
      setIsOwner(false);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // Get current user
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      
      if (userError || !user) {
        setRole(null);
        setIsOwner(false);
        setLoading(false);
        return;
      }

      // Check if user is project owner
      const { data: project, error: projectError } = await supabase
        .from('projects')
        .select('owner_id')
        .eq('id', projectId)
        .single();

      if (projectError) {
        throw projectError;
      }

      const ownerCheck = project?.owner_id === user.id;
      setIsOwner(ownerCheck);

      // Get user's collaborator role
      const { data: collaborator, error: collaboratorError } = await supabase
        .from('project_collaborators')
        .select('role')
        .eq('project_id', projectId)
        .eq('user_id', user.id)
        .not('accepted_at', 'is', null) // Only accepted collaborators
        .single();

      if (collaboratorError && collaboratorError.code !== 'PGRST116') {
        // PGRST116 = no rows returned (not a collaborator)
        throw collaboratorError;
      }

      if (collaborator) {
        setRole(collaborator.role as CollaboratorRole);
      } else {
        setRole(null);
      }

      setLoading(false);
    } catch (err) {
      console.error('Error fetching collaborator permissions:', err);
      setError(err instanceof Error ? err.message : 'Failed to load permissions');
      setLoading(false);
    }
  }, [projectId, supabase]);

  useEffect(() => {
    fetchPermissions();
  }, [fetchPermissions]);

  // Subscribe to collaborator changes for this user/project
  useEffect(() => {
    if (!projectId) return;

    const channel = supabase
      .channel(`collaborator-permissions:${projectId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'project_collaborators',
          filter: `project_id=eq.${projectId}`,
        },
        () => {
          // Refetch permissions when collaborators change
          fetchPermissions();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [projectId, supabase, fetchPermissions]);

  // Calculate derived permissions
  const isAdmin = role === 'admin';
  const isEditor = role === 'editor';
  const isViewer = role === 'viewer';

  return {
    role,
    isOwner,
    isAdmin,
    isEditor,
    isViewer,
    canInvite: role ? canUserInviteWithRole(role, 'viewer') : false, // Can invite at least viewers
    canInviteAsAdmin: role === 'admin',
    canManageCollaborators: role ? canUserManageCollaborators(role) : false,
    canEdit: role ? canUserEdit(role) : false,
    canView: role !== null, // Has any role = can view
    loading,
    error,
    refetch: fetchPermissions,
  };
}

/**
 * Hook variant that throws if user lacks required role
 * Useful for pages that require specific permissions
 * 
 * @param projectId - Project ID to check permissions for
 * @param requiredRole - Minimum required role ('admin', 'editor', or 'viewer')
 * @returns Permissions object (or throws if insufficient permissions)
 * 
 * @example
 * ```typescript
 * function AdminOnlyPage({ projectId }: { projectId: string }) {
 *   const permissions = useRequiredPermissions(projectId, 'admin');
 *   
 *   // This line only runs if user is admin
 *   return <AdminDashboard permissions={permissions} />;
 * }
 * ```
 */
export function useRequiredPermissions(
  projectId: string,
  requiredRole: CollaboratorRole
): CollaboratorPermissions {
  const permissions = useCollaboratorPermissions(projectId);

  useEffect(() => {
    if (permissions.loading) return;
    
    if (permissions.error) {
      throw new Error(`Permission check failed: ${permissions.error}`);
    }

    if (!permissions.role) {
      throw new Error('You do not have access to this project');
    }

    // Role hierarchy: admin > editor > viewer
    const roleHierarchy: Record<CollaboratorRole, number> = {
      admin: 3,
      editor: 2,
      viewer: 1,
    };

    if (roleHierarchy[permissions.role] < roleHierarchy[requiredRole]) {
      throw new Error(`This action requires ${requiredRole} permissions`);
    }
  }, [permissions, requiredRole]);

  return permissions;
}

