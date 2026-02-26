/**
 * Library Header Component
 * 
 * Displays library header with:
 * - Library name and description
 * - Version control and more options
 * - Share button for collaboration
 * - Viewing members indicator
 */

'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import { Avatar, Tooltip, Badge } from 'antd';
import Image from 'next/image';
import { InviteCollaboratorModal } from '@/components/collaboration/InviteCollaboratorModal';
import { showSuccessToast } from '@/lib/utils/toast';
import type { PresenceState } from '@/lib/types/collaboration';
import type { CollaboratorRole } from '@/lib/types/collaboration';
import styles from './LibraryHeader.module.css';
import libraryHeadMoreIcon from '@/assets/images/moreOptionsIcon.svg';
import libraryHeadVersionControlIcon from '@/assets/images/libraryHeadVersionControlIcon.svg';
import libraryHeadExpandCollaborators from '@/assets/images/libraryHeadExpandCollaborators.svg';
import libraryHeadShareIcon from '@/assets/images/libraryHeadShareIcon.svg';

interface LibraryHeaderProps {
  libraryId: string;
  libraryName: string;
  libraryDescription?: string | null;
  projectId: string;
  currentUserId: string;
  currentUserName?: string;
  currentUserEmail?: string;
  currentUserAvatarColor?: string;
  userRole: CollaboratorRole;
  presenceUsers: PresenceState[];
  isVersionControlOpen?: boolean;
  onVersionControlToggle?: () => void;
}

export function LibraryHeader({
  libraryId,
  libraryName,
  libraryDescription,
  projectId,
  currentUserId,
  currentUserName = 'You',
  currentUserEmail = '',
  currentUserAvatarColor = '#999999',
  userRole,
  presenceUsers,
  isVersionControlOpen = false,
  onVersionControlToggle,
}: LibraryHeaderProps) {
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

  // Sort presence users: current user first, then by last activity
  const sortedPresenceUsers = useMemo(() => {
    let users = [...presenceUsers];
    
    // Check if current user is in the list
    const hasCurrentUser = users.some(u => u.userId === currentUserId);
    
    // Always add current user to ensure they see themselves
    if (!hasCurrentUser) {
      users.push({
        userId: currentUserId,
        userName: currentUserName,
        userEmail: currentUserEmail,
        avatarColor: currentUserAvatarColor,
        activeCell: { assetId: null, propertyKey: '__viewing_library__' },
        cursorPosition: null,
        lastActivity: new Date().toISOString(),
        connectionStatus: 'online' as const,
      });
    }
    
    return users.sort((a, b) => {
      // Current user always first
      if (a.userId === currentUserId) return -1;
      if (b.userId === currentUserId) return 1;
      
      // Then sort by last activity (most recent first)
      return new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime();
    });
  }, [presenceUsers, currentUserId, currentUserName, currentUserEmail, currentUserAvatarColor]);

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
      activeCell: null,
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
  }, [sortedPresenceUsers, currentUserId, currentUserName, currentUserEmail, currentUserAvatarColor]);

  // Get remaining count (excluding displayed users)
  // If current user is displayed, count should exclude them
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
      {/* <div className={styles.leftSection}>
        <h1 className={styles.title}>{libraryName}</h1>
        {libraryDescription && (
          <Tooltip title={libraryDescription.length > 50 ? libraryDescription : undefined}>
            <div className={styles.description}>
              {libraryDescription.length > 50
                ? `${libraryDescription.slice(0, 50)}...`
                : libraryDescription}
            </div>
          </Tooltip>
        )}
      </div> */}

      <div className={styles.rightSection}>
           {/* Viewing Members Indicator */}
        <div className={styles.membersSection} ref={membersPanelRef}>
          <div className={styles.membersAvatars}>
            {displayUsers.map((user, index) => (
              <Tooltip key={user.userId} title={user.userName} placement="bottom">
                <Avatar
                  size={30}
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
                  size={30}
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
              <Image src={libraryHeadExpandCollaborators}
                alt="Expand"
                width={16} height={16} className="icon-16"
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
                        className={styles.currentUserAvatar}
                        size={30}
                        style={{ backgroundColor: currentUser.avatarColor }}
                      >
                        {getUserInitials(currentUser.userName)}
                      </Avatar>
                      <div className={styles.memberInfo}>
                        <Tooltip title={currentUser.userName}>
                          <div className={styles.memberName}>
                            {currentUser.userName && currentUser.userName.length > 10
                              ? `${currentUser.userName.slice(0, 10)}...`
                              : currentUser.userName}{' '}  
                            <span className={styles.youLabel}>(you)</span>
                          </div>
                        </Tooltip>
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
                          size={30}
                          className={styles.memberAvatar}
                          style={{ backgroundColor: user.avatarColor }}
                        >
                          {getUserInitials(user.userName)}
                        </Avatar>
                        <div className={styles.memberInfo}>
                          <Tooltip title={user.userName}>
                            <div className={styles.memberName}>
                              {user.userName && user.userName.length > 10
                                ? `${user.userName.slice(0, 10)}...`
                                : user.userName}
                            </div>
                          </Tooltip>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className={styles.emptyState}>
                      No one else is currently viewing this library
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
              <Image src={libraryHeadShareIcon}
                alt="Share"
                width={20} height={20} className="icon-20"
              />
              Share
          </button>
        </div>

        {/* More Options: mount to body + fixed so tooltip does not extend scroll area */}
        {/* <Tooltip
          title="More Options"
          getPopupContainer={() => document.body}
          styles={{ root: { position: 'fixed' } }}
        >
          <button className={styles.iconButton}>
            <Image src={libraryHeadMoreIcon}
              alt="More"
              width={20} height={20} className="icon-20"
            />
          </button>
        </Tooltip> */}
        {/* Version Control: mount to body + fixed so tooltip does not extend scroll area */}
        <Tooltip
          title="Version Control"
          getPopupContainer={() => document.body}
          styles={{ root: { position: 'fixed' } }}
        >
          <button 
            className={styles.iconButton}
            onClick={onVersionControlToggle}
          >
            <Image src={libraryHeadVersionControlIcon}
              alt="Version Control"
              width={20} height={20} className="icon-20"
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
        onSuccess={(email: string, message: string, autoAccepted: boolean) => {
          // Show success message using custom toast
          showSuccessToast(message);
        }}
        title={`Share ${libraryName}..`}
      />
    </div>
  );
}

