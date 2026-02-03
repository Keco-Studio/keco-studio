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

import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Image from 'next/image';
import { useSupabase } from '@/lib/SupabaseContext';
import { useUpdateCollaboratorRole, useRemoveCollaborator } from '@/lib/hooks/useCacheMutations';
import { queryKeys } from '@/lib/utils/queryKeys';
import { showSuccessToast } from '@/lib/utils/toast';
import type { Collaborator } from '@/lib/types/collaboration';
import styles from './CollaboratorsList.module.css';
import collaborationDeleteIcon from '@/assets/images/collaborationDeleteIcon.svg';

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
  const queryClient = useQueryClient();
  
  // Cache mutation hooks
  const updateRole = useUpdateCollaboratorRole();
  const removeCollaborator = useRemoveCollaborator();
  
  // Track if we're performing a local mutation to avoid unnecessary refetches
  const isLocalMutation = useRef(false);
  
  // Use React Query to read from cache
  // The cache will be updated by our mutation hooks
  const { data: cachedCollaborators } = useQuery<Collaborator[]>({
    queryKey: queryKeys.projectCollaborators(projectId),
    queryFn: async () => initialCollaborators,
    initialData: initialCollaborators,
    staleTime: Infinity, // Don't automatically refetch, rely on parent for initial data
  });
  
  // Use cached data if available, otherwise fall back to prop
  const collaborators = cachedCollaborators || initialCollaborators;
  
  // State management
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [highlightedUserId, setHighlightedUserId] = useState<string | null>(highlightUserId);
  
  // Computed values
  const isAdmin = currentUserRole === 'admin';
  const canManage = isAdmin;
  
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
  
  // Real-time subscription for database changes (from other users)
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
          // Skip if this is our own mutation (already updated via optimistic update)
          if (isLocalMutation.current) {
            isLocalMutation.current = false;
            return;
          }
          
          // For changes from other users, call onUpdate to refresh data
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
  
  // Handle role change
  const handleRoleChange = (collaboratorId: string, newRole: 'admin' | 'editor' | 'viewer', currentRole: string) => {
    if (!canManage) return;
    if (newRole === currentRole) return;
    
    // Clear any previous errors
    setError(null);
    
    // Mark as local mutation to skip real-time subscription update
    isLocalMutation.current = true;
    
    // Use cache mutation hook for optimistic update
    updateRole.mutate(
      { collaboratorId, projectId, newRole },
      {
        onError: (err: any) => {
          // Display error to user
          setError(err.message || 'Failed to update role');
          // Reset flag on error
          isLocalMutation.current = false;
        }
      }
    );
  };
  
  // Handle delete button click - show modal
  const handleDeleteClick = (collaboratorId: string) => {
    if (!canManage) return;
    setConfirmingDelete(collaboratorId);
  };
  
  // Handle collaborator removal (called from modal)
  const handleRemoveCollaborator = (collaboratorId: string, userName: string) => {
    if (!canManage) return;
    
    setError(null);
    setConfirmingDelete(null);
    
    // Mark as local mutation to skip real-time subscription update
    isLocalMutation.current = true;
    
    // Use cache mutation hook for optimistic update
    removeCollaborator.mutate(
      { collaboratorId, projectId },
      {
        onError: (err: any) => {
          // Display error to user
          setError(err.message || 'Failed to remove collaborator');
          // Reset flag on error
          isLocalMutation.current = false;
        },
        onSuccess: () => {
          const name = (userName && userName.trim()) ? userName : 'Collaborator';
          showSuccessToast(`${name} removed`);
        },
      }
    );
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
          const isLoading = updateRole.isPending || removeCollaborator.isPending;
          const isSelf = isCurrentUser(collab.userId);
          const isConfirmingDelete = confirmingDelete === collab.id;
          const displayName = getDisplayName(collab);
          const email = getEmail(collab);
          
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
                    value={collab.role}
                    onChange={(e) => handleRoleChange(collab.id, e.target.value as any, collab.role)}
                    disabled={isLoading}
                  >
                    <option value="admin">Admin</option>
                    <option value="editor">Editor</option>
                    <option value="viewer">Viewer</option>
                  </select>
                ) : (
                  <div className={styles.roleText}>
                    {collab.role.charAt(0).toUpperCase() + collab.role.slice(1)}
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
                      <Image src={collaborationDeleteIcon}
                        alt="Delete"
                        width={32} height={32} className="icon-32"
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
                disabled={removeCollaborator.isPending}
              >
                Cancel
              </button>
              <button
                className={styles.modalRemoveButton}
                onClick={() => handleRemoveCollaborator(
                  collaboratorToDelete.id,
                  getDisplayName(collaboratorToDelete)
                )}
                disabled={removeCollaborator.isPending}
              >
                {removeCollaborator.isPending ? 'Removing...' : 'Remove'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

