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
import Image from 'next/image';
import { useSupabase } from '@/lib/SupabaseContext';
import type { Collaborator } from '@/lib/types/collaboration';
import styles from './CollaboratorsList.module.css';
import collaborationDeleteIcon from '@/app/assets/images/collaborationDeleteIcon.svg';

interface CollaboratorsListProps {
  projectId: string;
  collaborators: Collaborator[];
  currentUserId: string;
  currentUserRole: 'admin' | 'editor' | 'viewer';
  onUpdate?: () => void;
  highlightUserId?: string | null; // User ID to highlight with animation
}

export default function CollaboratorsList({
  projectId,
  collaborators: initialCollaborators,
  currentUserId,
  currentUserRole,
  onUpdate,
  highlightUserId = null,
}: CollaboratorsListProps) {
  const supabase = useSupabase();
  
  // State management
  const [collaborators, setCollaborators] = useState<Collaborator[]>(initialCollaborators);
  const [optimisticUpdates, setOptimisticUpdates] = useState<Map<string, { role?: string; removing?: boolean }>>(new Map());
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [loadingActions, setLoadingActions] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [highlightedUserId, setHighlightedUserId] = useState<string | null>(highlightUserId);
  
  // Computed values
  const isAdmin = currentUserRole === 'admin';
  const canManage = isAdmin;
  
  // Update collaborators when prop changes
  useEffect(() => {
    setCollaborators(initialCollaborators);
  }, [initialCollaborators]);
  
  // Handle highlight animation
  useEffect(() => {
    if (highlightUserId) {
      setHighlightedUserId(highlightUserId);
      // Remove highlight after 2 seconds
      const timer = setTimeout(() => {
        setHighlightedUserId(null);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [highlightUserId]);
  
  // Real-time subscription for database changes
  useEffect(() => {
    if (!projectId) return;
    
    
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
          
          // Refresh collaborators list when changes occur
          if (onUpdate) {
            onUpdate();
          }
        }
      )
      .subscribe((status) => {
      });
    
    return () => {
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
      
      // Get session for authorization
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        throw new Error('You must be logged in');
      }
      
      // Call API route with authorization header
      const response = await fetch(`/api/collaborators/${collaboratorId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ newRole }),
      });

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
  
  // Handle delete button click - show modal
  const handleDeleteClick = (collaboratorId: string) => {
    if (!canManage) return;
    setConfirmingDelete(collaboratorId);
  };
  
  // Handle collaborator removal (called from modal)
  const handleRemoveCollaborator = async (collaboratorId: string, userName: string) => {
    if (!canManage) return;
    
    setError(null);
    setConfirmingDelete(null);
    setLoadingActions(prev => new Set(prev).add(collaboratorId));
    
    // Apply optimistic update
    setOptimisticUpdates(prev => new Map(prev).set(collaboratorId, { removing: true }));
    
    try {
      
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
  
  // Get collaborator being deleted for modal
  const getCollaboratorBeingDeleted = () => {
    if (!confirmingDelete) return null;
    return collaborators.find(c => c.id === confirmingDelete);
  };
  
  const collaboratorToDelete = getCollaboratorBeingDeleted();
  
  // Check if user is current user
  const isCurrentUser = (userId: string) => userId === currentUserId;
  
  // Get display name for collaborator
  const getDisplayName = (collab: Collaborator): string => {
    // If userName exists and is not empty, use it
    if (collab.userName && collab.userName.trim()) {
      return collab.userName;
    }
    // Otherwise, extract name from email (before @)
    if (collab.userEmail) {
      return collab.userEmail.split('@')[0];
    }
    // Fallback
    return 'User';
  };
  
  // Get email for collaborator
  const getEmail = (collab: Collaborator): string => {
    return collab.userEmail || '';
  };
  
  // Get avatar initials for display
  const getAvatarInitials = (collab: Collaborator): string => {
    const displayName = getDisplayName(collab);
    // Get first character of display name
    return displayName.charAt(0).toUpperCase();
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
      
      {/* Column Headers */}
      <div className={styles.tableHeader}>
        <div className={styles.headerName}>MEMBER NAME</div>
        <div className={styles.headerEmail}>EMAIL</div>
        <div className={styles.headerRoleType}>ROLE TYPE</div>
        {isAdmin && <div className={styles.headerActions}></div>}
      </div>
      
      {/* Collaborators list */}
      <div className={styles.list}>
        {collaborators.map((collab) => {
          const effectiveRole = getEffectiveRole(collab.id, collab.role);
          const isRemoving = isBeingRemoved(collab.id);
          const isLoading = loadingActions.has(collab.id);
          const isSelf = isCurrentUser(collab.userId);
          const isConfirmingDelete = confirmingDelete === collab.id;
          const displayName = getDisplayName(collab);
          const email = getEmail(collab);
          
          if (isRemoving) {
            return null; // Hide removed items optimistically
          }
          
          // Check if this user should be highlighted
          const shouldHighlight = highlightedUserId === collab.userId;
          // Check if invitation is pending (not yet accepted)
          const isPendingInvite = !collab.acceptedAt;
          
          return (
            <div 
              key={collab.id}
              className={`${styles.item} ${isLoading ? styles.itemLoading : ''} ${shouldHighlight ? styles.itemHighlight : ''}`}
            >
              {/* Member Name Column */}
              <div className={styles.itemName}>
                <div 
                  className={styles.avatar}
                  style={{ 
                    backgroundColor: collab.avatarColor || '#94a3b8' 
                  }}
                >
                  {getAvatarInitials(collab)}
                </div>
                <div className={`${styles.userName} ${isSelf ? styles.userNameSelf : ''}`}>
                  {displayName}
                  {isSelf && (
                    <span className={styles.youBadge}>(me)</span>
                  )}
                  {isPendingInvite && (
                    <span className={styles.inviteSentBadge}>(invite sent)</span>
                  )}
                </div>
              </div>
              
              {/* Email Column */}
              <div className={styles.itemEmail}>
                {email || '-'}
              </div>
              
              {/* Role Type Column */}
              <div className={styles.itemRoleType}>
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
                  <div className={styles.roleText}>
                    {effectiveRole.charAt(0).toUpperCase() + effectiveRole.slice(1)}
                  </div>
                )}
              </div>
              
              {/* Delete button for admin (at the end) */}
              {canManage ? (
                !isSelf ? (
                  <div className={styles.itemActions}>
                    <button
                      className={styles.deleteButton}
                      onClick={() => handleDeleteClick(collab.id)}
                      disabled={isLoading}
                      title="Remove collaborator"
                      aria-label={`Remove ${displayName}`}
                    >
                      <Image
                        src={collaborationDeleteIcon}
                        alt="Delete"
                        width={32}
                        height={32}
                      />
                    </button>
                  </div>
                ) : (
                  <div className={styles.itemActions}></div>
                )
              ) : null}
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
      
      {/* Delete Confirmation Modal */}
      {collaboratorToDelete && (
        <div className={styles.modalOverlay} onClick={handleCancelDelete}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3 className={styles.modalTitle}>Remove collaborator</h3>
              <button
                className={styles.modalClose}
                onClick={handleCancelDelete}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className={styles.modalBody}>
              <p>Are you sure you want to remove this collaborator?</p>
            </div>
            <div className={styles.modalFooter}>
              <button
                className={styles.modalCancelButton}
                onClick={handleCancelDelete}
                disabled={loadingActions.has(collaboratorToDelete.id)}
              >
                Cancel
              </button>
              <button
                className={styles.modalRemoveButton}
                onClick={() => handleRemoveCollaborator(
                  collaboratorToDelete.id,
                  getDisplayName(collaboratorToDelete)
                )}
                disabled={loadingActions.has(collaboratorToDelete.id)}
              >
                {loadingActions.has(collaboratorToDelete.id) ? 'Removing...' : 'Remove'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

