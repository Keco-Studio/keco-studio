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
import Image from 'next/image';
import { useUpdateCollaboratorRole, useRemoveCollaborator } from '@/lib/hooks/useCacheMutations';
import { showSuccessToast } from '@/lib/utils/toast';
import type { Collaborator } from '@/lib/types/collaboration';
import { useCollaboratorChangeBroadcast } from '@/lib/hooks/useProjectCollaboratorsRealtime';
import styles from './CollaboratorsList.module.css';
import collaborationDeleteIcon from '@/assets/images/collaborationDeleteIcon.svg';

interface CollaboratorsListProps {
  projectId: string;
  collaborators: Collaborator[];
  currentUserId: string;
  currentUserRole: 'admin' | 'editor' | 'viewer';
  onUpdate?: () => void;
  onSelfRemoved?: () => void; // Called when current user is removed from collaborators
  highlightUserId?: string | null; // User ID to highlight with animation
}

export default function CollaboratorsList({
  projectId,
  collaborators,
  currentUserId,
  currentUserRole,
  onUpdate,
  onSelfRemoved,
  highlightUserId = null,
}: CollaboratorsListProps) {
  // Cache mutation hooks
  const updateRole = useUpdateCollaboratorRole();
  const removeCollaborator = useRemoveCollaborator();
  const broadcastCollaboratorChange = useCollaboratorChangeBroadcast();
  
  // State management
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [highlightedUserId, setHighlightedUserId] = useState<string | null>(highlightUserId);
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);
  const dropdownRefs = useRef<Record<string, HTMLDivElement | null>>({});
  
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

  // Handle click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (openDropdownId) {
        const dropdownElement = dropdownRefs.current[openDropdownId];
        if (dropdownElement && !dropdownElement.contains(event.target as Node)) {
          setOpenDropdownId(null);
        }
      }
    };

    if (openDropdownId) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [openDropdownId]);
  
  // Handle role change
  const handleRoleChange = (collaboratorId: string, newRole: 'admin' | 'editor' | 'viewer', currentRole: string) => {
    if (!canManage) return;
    if (newRole === currentRole) return;
    
    // Find the user being affected (before role change)
    const affectedCollab = collaborators.find(c => c.id === collaboratorId);
    const affectedUserId = affectedCollab?.userId || null;
    
    // Clear any previous errors
    setError(null);
    
    // Use cache mutation hook for optimistic update
    updateRole.mutate(
      { collaboratorId, projectId, newRole },
      {
        onSuccess: () => {
          // Broadcast to other users so they refresh (including the affected user)
          // Include affectedUserId so ProjectLayout can detect if current user's role changed
          void broadcastCollaboratorChange({
            type: 'role-change',
            collaboratorId,
            newRole,
            affectedUserId,
          });
          onUpdate?.();
        },
        onError: (err: any) => {
          // Display error to user
          setError(err.message || 'Failed to update role');
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
    
    // Find the user being removed (before optimistic update removes them from list)
    const removedCollab = collaborators.find(c => c.id === collaboratorId);
    const removedUserId = removedCollab?.userId || null;
    
    setError(null);
    setConfirmingDelete(null);
    
    // Use cache mutation hook for optimistic update
    removeCollaborator.mutate(
      { collaboratorId, projectId },
      {
        onError: (err: any) => {
          // Display error to user
          setError(err.message || 'Failed to remove collaborator');
        },
        onSuccess: () => {
          const name = (userName && userName.trim()) ? userName : 'Collaborator';
          showSuccessToast(`${name} removed`);
          
          // Broadcast to other users so they refresh
          // Include removedUserId so the removed user can detect self-removal and redirect
          const broadcastPayload = { type: 'delete' as const, collaboratorId, removedUserId };
          void broadcastCollaboratorChange(broadcastPayload);
          onUpdate?.();
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
        <div className={styles.errorBanner} data-testid="collaborators-error">
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
        <div className={styles.headerEmail}></div>
        <div className={styles.headerRoleType}>ADMIN</div>
        <div className={styles.headerActions}></div>
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
              data-testid="collaborator-row"
              data-collaborator-id={collab.id}
              data-user-id={collab.userId}
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
                  <div 
                    className={styles.customSelectWrapper}
                    ref={(el) => { dropdownRefs.current[collab.id] = el; }}
                  >
                    <button
                      type="button"
                      className={styles.customSelectButton}
                      onClick={() => setOpenDropdownId(openDropdownId === collab.id ? null : collab.id)}
                      disabled={isLoading}
                      data-testid="collaborator-role-button"
                    >
                      {collab.role.charAt(0).toUpperCase() + collab.role.slice(1)}
                      <svg width="14" height="8" viewBox="0 0 14 8" fill="none" xmlns="http://www.w3.org/2000/svg" className={styles.selectArrow}>
                        <path d="M1 1L7 7L13 1" stroke="#BCBCBC" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </button>
                    {openDropdownId === collab.id && (
                      <div className={styles.customSelectDropdown}>
                        {(['admin', 'editor', 'viewer'] as const).map((role) => (
                          <button
                            key={role}
                            type="button"
                            className={`${styles.customSelectOption} ${collab.role === role ? styles.customSelectOptionSelected : ''}`}
                            onClick={() => {
                              handleRoleChange(collab.id, role, collab.role);
                              setOpenDropdownId(null);
                            }}
                            data-testid={`collaborator-role-option-${role}`}
                          >
                            {role.charAt(0).toUpperCase() + role.slice(1)}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className={styles.roleText}>
                    {collab.role.charAt(0).toUpperCase() + collab.role.slice(1)}
                  </div>
                )}
              </div>
              
              {/* Delete button for admin (at the end) */}
              <div className={styles.itemActions}>
                {canManage && !isSelf ? (
                  <button
                    className={styles.deleteButton}
                    onClick={() => handleDeleteClick(collab.id)}
                    disabled={isLoading}
                    title="Remove collaborator"
                    aria-label={`Remove ${displayName}`}
                    data-testid="collaborator-remove-button"
                  >
                    <Image src={collaborationDeleteIcon}
                      alt="Delete"
                      width={20} height={20} className="icon-20"
                    />
                  </button>
                ) : null}
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
