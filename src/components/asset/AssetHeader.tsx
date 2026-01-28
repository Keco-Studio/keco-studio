/**
 * Asset Header Component
 * 
 * Displays asset header with:
 * - Asset name
 * - Share button for collaboration
 * - Viewing members indicator
 * - More options
 * 
 * Similar to LibraryHeader but without version control
 */

'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import { Avatar, Tooltip } from 'antd';
import Image from 'next/image';
import { InviteCollaboratorModal } from '@/components/collaboration/InviteCollaboratorModal';
import type { PresenceState } from '@/lib/types/collaboration';
import type { CollaboratorRole } from '@/lib/types/collaboration';
import styles from './AssetHeader.module.css';
import libraryHeadMoreIcon from '@/app/assets/images/libraryHeadMoreIcon.svg';
import libraryHeadExpandCollaborators from '@/app/assets/images/libraryHeadExpandCollaborators.svg';
import libraryHeadEditIcon from '@/app/assets/images/assetEditIcon.svg';
import libraryHeadViewIcon from '@/app/assets/images/assetViewIcon.svg';

interface AssetHeaderProps {
  assetId: string;
  assetName: string;
  projectId: string;
  libraryId: string;
  libraryName?: string;
  currentUserId: string;
  currentUserName?: string;
  currentUserEmail?: string;
  currentUserAvatarColor?: string;
  userRole: CollaboratorRole;
  presenceUsers: PresenceState[];
}

export function AssetHeader({
  assetId,
  assetName,
  projectId,
  libraryId,
  libraryName = '',
  currentUserId,
  currentUserName = 'You',
  currentUserEmail = '',
  currentUserAvatarColor = '#999999',
  userRole,
  presenceUsers,
}: AssetHeaderProps) {
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showMembersPanel, setShowMembersPanel] = useState(false);
  const membersPanelRef = useRef<HTMLDivElement>(null);
  const hasInitializedPresence = useRef(false);

  // Get role display text
  const getRoleText = (role: CollaboratorRole): string => {
    switch (role) {
      case 'admin':
        return 'predefine';
      case 'editor':
        return 'editing';
      case 'viewer':
        return 'viewing';
      default:
        return 'viewing';
    }
  };

  // Filter presence users to only show those viewing/editing this specific asset
  const assetPresenceUsers = useMemo(() => {
    const filtered = presenceUsers.filter(user => {
      // Check if user is viewing or editing this asset
      return user.activeCell?.assetId === assetId;
    });
    
    // Check if current user is in the list
    const hasCurrentUser = filtered.some(u => u.userId === currentUserId);
    
    // Always add current user to ensure they see themselves
    // This is a UI-only addition and doesn't affect the underlying presence system
    if (!hasCurrentUser) {
      filtered.push({
        userId: currentUserId,
        userName: currentUserName,
        userEmail: currentUserEmail,
        avatarColor: currentUserAvatarColor,
        activeCell: { assetId, propertyKey: '__viewing__' },
        cursorPosition: null,
        lastActivity: new Date().toISOString(),
        connectionStatus: 'online' as const,
      });
    }
    
    return filtered;
  }, [presenceUsers, assetId, currentUserId, currentUserName, currentUserEmail, currentUserAvatarColor]);

  // Sort presence users: current user first, then by last activity
  const sortedPresenceUsers = useMemo(() => {
    // assetPresenceUsers already includes current user
    return [...assetPresenceUsers].sort((a, b) => {
      // Current user always first
      if (a.userId === currentUserId) return -1;
      if (b.userId === currentUserId) return 1;
      
      // Then sort by last activity (most recent first)
      return new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime();
    });
  }, [assetPresenceUsers, currentUserId]);

  // Get users for avatar display (max 2)
  // Memoized more aggressively to avoid flickering
  const displayUsers = useMemo(() => {
    const result = [];
    
    // Find current user in sorted list
    const currentUserInList = sortedPresenceUsers.find(u => u.userId === currentUserId);
    
    // Use existing user object if available, otherwise create stable placeholder
    const currentUser = currentUserInList || {
      userId: currentUserId,
      userName: currentUserName,
      userEmail: currentUserEmail,
      avatarColor: currentUserAvatarColor,
      activeCell: { assetId, propertyKey: '__viewing__' },
      cursorPosition: null,
      lastActivity: new Date().toISOString(),
      connectionStatus: 'online' as const,
    };
    
    result.push(currentUser);
    
    // Second: most recent other user
    const otherUsers = sortedPresenceUsers.filter(u => u.userId !== currentUserId);
    if (otherUsers.length > 0) {
      result.push(otherUsers[0]);
    }
    
    return result;
  }, [sortedPresenceUsers, currentUserId, currentUserName, currentUserEmail, currentUserAvatarColor, assetId]);

  // Get remaining count (excluding displayed users)
  const remainingCount = useMemo(() => {
    const displayed = displayUsers.length;
    const total = sortedPresenceUsers.length;
    return Math.max(0, total - displayed);
  }, [displayUsers.length, sortedPresenceUsers.length]);

  // Get user initials
  const getUserInitials = (name: string): string => {
    const parts = name.trim().split(/\s+/);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
  };

  // Close members panel when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (membersPanelRef.current && !membersPanelRef.current.contains(event.target as Node)) {
        setShowMembersPanel(false);
      }
    };

    if (showMembersPanel) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [showMembersPanel]);

  return (
    <div className={styles.header}>
      <div className={styles.leftSection}>
        <h1 className={styles.title}>{assetName || 'Untitled Asset'}</h1>
      </div>

      <div className={styles.rightSection}>
        {/* Viewing Members Indicator */}
        <div className={styles.membersSection} ref={membersPanelRef}>
          <div className={styles.membersAvatars}>
            {displayUsers.map((user, index) => (
              <Tooltip key={user.userId} title={user.userName} placement="bottom">
                <Avatar
                  size={32}
                  className={styles.memberAvatar}
                  style={{
                    backgroundColor: user.avatarColor,
                    zIndex: displayUsers.length - index,
                    marginLeft: index > 0 ? '-8px' : '0',
                  }}
                >
                  {getUserInitials(user.userName)}
                </Avatar>
              </Tooltip>
            ))}
            
            {remainingCount > 0 && (
              <Tooltip title={`${remainingCount} more ${remainingCount === 1 ? 'member' : 'members'}`} placement="bottom">
                <Avatar
                  size={32}
                  className={`${styles.memberAvatar} ${styles.remainingCount}`}
                  style={{
                    backgroundColor: '#f0f0f0',
                    color: '#666',
                    marginLeft: '-8px',
                    zIndex: 0,
                  }}
                >
                  +{remainingCount}
                </Avatar>
              </Tooltip>
            )}
          </div>
          
          {/* Expand Collaborators Button */}
          <Tooltip title="View all members">
            <button
              className={styles.expandCollaboratorsButton}
              onClick={() => setShowMembersPanel(!showMembersPanel)}
              aria-label="View all members"
            >
              <Image
                src={libraryHeadExpandCollaborators}
                alt="Expand"
                width={16}
                height={16}
              />
            </button>
          </Tooltip>

          {/* Members Panel */}
          {showMembersPanel && (() => {
            const currentUser = sortedPresenceUsers.find(u => u.userId === currentUserId);
            const otherUsers = sortedPresenceUsers.filter(u => u.userId !== currentUserId);
            
            return (
              <div className={styles.membersPanel}>
                {/* Current User Section */}
                {currentUser && (
                  <div className={styles.currentUserSection}>
                    <div className={styles.currentUserItem}>
                      <Avatar
                        size={36}
                        style={{ backgroundColor: currentUser.avatarColor }}
                      >
                        {getUserInitials(currentUser.userName)}
                      </Avatar>
                      <div className={styles.memberInfo}>
                        <div className={styles.memberName}>
                          {currentUser.userName} <span className={styles.youLabel}>(you)</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                
                {/* Currently Viewing Section */}
                <div className={styles.membersPanelHeader}>
                  CURRENTLY VIEWING
                </div>
                <div className={styles.membersList}>
                  {otherUsers.length > 0 ? (
                    otherUsers.map((user) => (
                      <div
                        key={user.userId}
                        className={styles.memberItem}
                      >
                        <Avatar
                          size={36}
                          style={{ backgroundColor: user.avatarColor }}
                        >
                          {getUserInitials(user.userName)}
                        </Avatar>
                        <div className={styles.memberInfo}>
                          <div className={styles.memberName}>
                            {user.userName}
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className={styles.emptyState}>
                      No one else is currently viewing this asset
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
        </div>

        {/* Share Button */}
        <div className={styles.shareSection}>
          <button
            className={styles.shareButton}
            onClick={() => setShowInviteModal(true)}
          >
            Share
          </button>
          {userRole === 'admin' && (
            <button className={styles.adminRoleLabel}>
              {getRoleText(userRole)}
            </button>
          )}
          {userRole === 'editor' && (
            <button className={styles.editorRoleLabel}>
              <Image src={libraryHeadEditIcon} alt="Editing" width={16} height={16} />
              {getRoleText(userRole)}
            </button>
          )}
          {userRole === 'viewer' && (
            <button className={styles.viewerRoleLabel}>
              <Image src={libraryHeadViewIcon} alt="Viewing" width={16} height={16} />
              {getRoleText(userRole)}
            </button>
          )}
        </div>

        {/* More Options Icon (no Version Control) */}
        <Tooltip title="More Options">
          <button className={styles.iconButton}>
            <Image
              src={libraryHeadMoreIcon}
              alt="More"
              width={32}
              height={32}
            />
          </button>
        </Tooltip>
      </div>

      {/* Invite Collaborator Modal */}
      <InviteCollaboratorModal
        projectId={projectId}
        projectName={libraryName}
        userRole={userRole}
        open={showInviteModal}
        onClose={() => setShowInviteModal(false)}
        onSuccess={() => {
          // Handle success (e.g., refresh collaborators list)
        }}
        title="Invite new collaborator"
      />
    </div>
  );
}

