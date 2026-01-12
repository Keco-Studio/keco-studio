/**
 * CollaboratorsList Component
 * 
 * Displays project collaborators with role management and removal capabilities.
 * Features:
 * - View all active collaborators
 * - Edit roles (admin-only)
 * - Remove collaborators with confirmation (admin-only)
 * - Real-time updates via Supabase subscription
 * - Optimistic updates with rollback on error
 * - Validation for self-role-change and last-admin removal
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSupabase } from '@/lib/SupabaseContext';
import type { Collaborator } from '@/lib/types/collaboration';
import styles from './CollaboratorsList.module.css';

interface CollaboratorsListProps {
  projectId: string;
  collaborators: Collaborator[];
  currentUserId: string;
  currentUserRole: 'admin' | 'editor' | 'viewer';
  onUpdate?: () => void;
}

export default function CollaboratorsList({
  projectId,
  collaborators: initialCollaborators,
  currentUserId,
  currentUserRole,
  onUpdate,
}: CollaboratorsListProps) {
  const supabase = useSupabase();
  
  // State management
  const [collaborators, setCollaborators] = useState<Collaborator[]>(initialCollaborators);
  const [optimisticUpdates, setOptimisticUpdates] = useState<Map<string, { role?: string; removing?: boolean }>>(new Map());
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [loadingActions, setLoadingActions] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  
  // Computed values
  const isAdmin = currentUserRole === 'admin';
  const canManage = isAdmin;
  
  // Update collaborators when prop changes
  useEffect(() => {
    setCollaborators(initialCollaborators);
  }, [initialCollaborators]);
  
  // Real-time subscription for database changes
  useEffect(() => {
    if (!projectId) return;
    
    console.log('[CollaboratorsList] Setting up real-time subscription for project:', projectId);
    
    const channel = supabase
      .channel(`project:${projectId}:collaborators`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'project_collaborators',
          filter: `project_id=eq.${projectId}`,
        },
        (payload) => {
          console.log('[CollaboratorsList] Database change detected:', payload);
          
          // Refresh collaborators list when changes occur
          if (onUpdate) {
            onUpdate();
          }
        }
      )
      .subscribe((status) => {
        console.log('[CollaboratorsList] Subscription status:', status);
      });
    
    return () => {
      console.log('[CollaboratorsList] Cleaning up subscription');
      channel.unsubscribe();
    };
  }, [projectId, supabase, onUpdate]);
  
  // Get effective role for a collaborator (with optimistic updates)
  const getEffectiveRole = (collaboratorId: string, actualRole: string): string => {
    const optimistic = optimisticUpdates.get(collaboratorId);
    return optimistic?.role || actualRole;
  };
  
  // Check if collaborator is being removed (optimistically)
  const isBeingRemoved = (collaboratorId: string): boolean => {
    const optimistic = optimisticUpdates.get(collaboratorId);
    return optimistic?.removing || false;
  };
  
  // Handle role change
  const handleRoleChange = async (collaboratorId: string, newRole: 'admin' | 'editor' | 'viewer', currentRole: string) => {
    if (!canManage) return;
    if (newRole === currentRole) return;
    
    // Clear any previous errors
    setError(null);
    
    // Add loading state
    setLoadingActions(prev => new Set(prev).add(collaboratorId));
    
    // Apply optimistic update
    setOptimisticUpdates(prev => new Map(prev).set(collaboratorId, { role: newRole }));
    
    try {
      console.log(`[CollaboratorsList] Updating role: ${currentRole} → ${newRole}`);
      
      // Get session for authorization
      const { data: { session } } = await supabase.auth.getSession();
      console.log('[CollaboratorsList] Session:', session ? 'exists' : 'null');
      console.log('[CollaboratorsList] Access token:', session?.access_token ? `exists (length: ${session.access_token.length})` : 'null');
      
      if (!session) {
        throw new Error('You must be logged in');
      }
      
      // Call API route with authorization header
      console.log('[CollaboratorsList] Sending PATCH with auth header');
      const response = await fetch(`/api/collaborators/${collaboratorId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ newRole }),
      });
      console.log('[CollaboratorsList] Response status:', response.status);

      const result = await response.json();
      
      if (!response.ok || !result.success) {
        // Rollback optimistic update on error
        console.error('[CollaboratorsList] Role update failed:', result.error);
        setOptimisticUpdates(prev => {
          const next = new Map(prev);
          next.delete(collaboratorId);
          return next;
        });
        setError(result.error || 'Failed to update role');
      } else {
        console.log('[CollaboratorsList] Role updated successfully');
        // Clear optimistic update after success
        setOptimisticUpdates(prev => {
          const next = new Map(prev);
          next.delete(collaboratorId);
          return next;
        });
        
        // Trigger parent refresh
        if (onUpdate) {
          onUpdate();
        }
      }
    } catch (err: any) {
      console.error('[CollaboratorsList] Error updating role:', err);
      // Rollback optimistic update
      setOptimisticUpdates(prev => {
        const next = new Map(prev);
        next.delete(collaboratorId);
        return next;
      });
      setError(err.message || 'Failed to update role');
    } finally {
      setLoadingActions(prev => {
        const next = new Set(prev);
        next.delete(collaboratorId);
        return next;
      });
    }
  };
  
  // Handle collaborator removal
  const handleRemoveCollaborator = async (collaboratorId: string, userName: string) => {
    if (!canManage) return;
    
    // First click: show confirmation
    if (confirmingDelete !== collaboratorId) {
      setConfirmingDelete(collaboratorId);
      return;
    }
    
    // Second click: actually remove
    setError(null);
    setConfirmingDelete(null);
    setLoadingActions(prev => new Set(prev).add(collaboratorId));
    
    // Apply optimistic update
    setOptimisticUpdates(prev => new Map(prev).set(collaboratorId, { removing: true }));
    
    try {
      console.log(`[CollaboratorsList] Removing collaborator: ${userName}`);
      
      // Get session for authorization
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('You must be logged in');
      }
      
      // Call API route with authorization header
      const response = await fetch(`/api/collaborators/${collaboratorId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
        },
      });

      const result = await response.json();
      
      if (!response.ok || !result.success) {
        // Rollback optimistic update on error
        console.error('[CollaboratorsList] Remove failed:', result.error);
        setOptimisticUpdates(prev => {
          const next = new Map(prev);
          next.delete(collaboratorId);
          return next;
        });
        setError(result.error || 'Failed to remove collaborator');
      } else {
        console.log('[CollaboratorsList] Collaborator removed successfully');
        // Keep optimistic update until parent refreshes
        // The real-time subscription will trigger onUpdate()
        if (onUpdate) {
          onUpdate();
        }
      }
    } catch (err: any) {
      console.error('[CollaboratorsList] Error removing collaborator:', err);
      // Rollback optimistic update
      setOptimisticUpdates(prev => {
        const next = new Map(prev);
        next.delete(collaboratorId);
        return next;
      });
      setError(err.message || 'Failed to remove collaborator');
    } finally {
      setLoadingActions(prev => {
        const next = new Set(prev);
        next.delete(collaboratorId);
        return next;
      });
    }
  };
  
  // Cancel delete confirmation
  const handleCancelDelete = () => {
    setConfirmingDelete(null);
  };
  
  // Check if user is current user
  const isCurrentUser = (userId: string) => userId === currentUserId;
  
  // Get display name for collaborator
  const getDisplayName = (collab: Collaborator): string => {
    const profile = collab.profile || collab.user_profiles || collab.profiles;
    return profile?.username || profile?.full_name || profile?.name || profile?.email || 'User';
  };
  
  // Get email for collaborator
  const getEmail = (collab: Collaborator): string => {
    const profile = collab.profile || collab.user_profiles || collab.profiles;
    return profile?.email || '';
  };
  
  return (
    <div className={styles.container}>
      {/* Error banner */}
      {error && (
        <div className={styles.errorBanner}>
          {error}
          <button 
            className={styles.errorClose}
            onClick={() => setError(null)}
            aria-label="Dismiss error"
          >
            ×
          </button>
        </div>
      )}
      
      {/* Collaborators list */}
      <div className={styles.list}>
        {collaborators.map((collab) => {
          const effectiveRole = getEffectiveRole(collab.id, collab.role);
          const isRemoving = isBeingRemoved(collab.id);
          const isLoading = loadingActions.has(collab.id);
          const isSelf = isCurrentUser(collab.user_id);
          const isConfirmingDelete = confirmingDelete === collab.id;
          const displayName = getDisplayName(collab);
          const email = getEmail(collab);
          
          if (isRemoving) {
            return null; // Hide removed items optimistically
          }
          
          return (
            <div 
              key={collab.id}
              className={`${styles.item} ${isLoading ? styles.itemLoading : ''}`}
            >
              <div className={styles.itemLeft}>
                {/* Avatar */}
                <div 
                  className={styles.avatar}
                  style={{ 
                    backgroundColor: collab.avatar_color || '#94a3b8' 
                  }}
                >
                  {displayName.charAt(0).toUpperCase()}
                </div>
                
                {/* User info */}
                <div className={styles.userInfo}>
                  <div className={styles.userName}>
                    {displayName}
                    {isSelf && (
                      <span className={styles.youBadge}>(YOU)</span>
                    )}
                    {collab.is_owner && (
                      <span className={styles.ownerBadge}>Owner</span>
                    )}
                  </div>
                  {email && (
                    <div className={styles.userEmail}>{email}</div>
                  )}
                </div>
              </div>
              
              <div className={styles.itemRight}>
                {/* Role selector (admin-only for others, read-only for self) */}
                {canManage && !isSelf ? (
                  <select
                    className={styles.roleSelect}
                    value={effectiveRole}
                    onChange={(e) => handleRoleChange(collab.id, e.target.value as any, collab.role)}
                    disabled={isLoading}
                  >
                    <option value="admin">Admin</option>
                    <option value="editor">Editor</option>
                    <option value="viewer">Viewer</option>
                  </select>
                ) : (
                  <div className={`${styles.roleBadge} ${styles[`role${effectiveRole.charAt(0).toUpperCase() + effectiveRole.slice(1)}`]}`}>
                    {effectiveRole.charAt(0).toUpperCase() + effectiveRole.slice(1)}
                  </div>
                )}
                
                {/* Delete button (admin-only, not for self) */}
                {canManage && !isSelf && (
                  <>
                    {isConfirmingDelete ? (
                      <div className={styles.confirmDelete}>
                        <button
                          className={styles.confirmDeleteButton}
                          onClick={() => handleRemoveCollaborator(collab.id, displayName)}
                          disabled={isLoading}
                        >
                          Confirm
                        </button>
                        <button
                          className={styles.cancelDeleteButton}
                          onClick={handleCancelDelete}
                          disabled={isLoading}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        className={styles.deleteButton}
                        onClick={() => handleRemoveCollaborator(collab.id, displayName)}
                        disabled={isLoading}
                        title="Remove collaborator"
                        aria-label={`Remove ${displayName}`}
                      >
                        <svg 
                          width="16" 
                          height="16" 
                          viewBox="0 0 16 16" 
                          fill="none"
                          xmlns="http://www.w3.org/2000/svg"
                        >
                          <path 
                            d="M6 2h4M2 4h12M13.333 4l-.459 6.875a2 2 0 01-1.996 1.875H5.122a2 2 0 01-1.996-1.875L2.667 4M6.667 7.333v3.334M9.333 7.333v3.334" 
                            stroke="currentColor" 
                            strokeWidth="1.5" 
                            strokeLinecap="round" 
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
      
      {/* Empty state */}
      {collaborators.length === 0 && (
        <div className={styles.emptyState}>
          <p>No collaborators found</p>
        </div>
      )}
    </div>
  );
}

