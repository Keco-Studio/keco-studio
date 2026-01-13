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
import type { PresenceState } from '@/lib/types/collaboration';
import type { CollaboratorRole } from '@/lib/types/collaboration';
import styles from './LibraryHeader.module.css';
import libraryHeadMoreIcon from '@/app/assets/images/libraryHeadMoreIcon.svg';
import libraryHeadVersionControlIcon from '@/app/assets/images/libraryHeadVersionControlIcon.svg';
import libraryHeadExpandCollaborators from '@/app/assets/images/libraryHeadExpandCollaborators.svg';

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
}: LibraryHeaderProps) {
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showMembersPanel, setShowMembersPanel] = useState(false);
  const membersPanelRef = useRef<HTMLDivElement>(null);

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
  // Make sure current user is always included
  const sortedPresenceUsers = useMemo(() => {
    const users = [...presenceUsers];
    
    // Check if current user is in the list
    const hasCurrentUser = users.some(u => u.userId === currentUserId);
    
    // If current user is not in the list, add them
    if (!hasCurrentUser) {
      users.unshift({
        userId: currentUserId,
        userName: currentUserName,
        userEmail: currentUserEmail,
        avatarColor: currentUserAvatarColor,
        activeCell: null,
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

  // Get users for avatar display (max 3)
  const displayUsers = useMemo(() => {
    const result = [];
    
    // Always show current user first
    let currentUser = sortedPresenceUsers.find(u => u.userId === currentUserId);
    
    // If current user is not in presenceUsers, create a placeholder
    if (!currentUser) {
      currentUser = {
        userId: currentUserId,
        userName: currentUserName,
        userEmail: currentUserEmail,
        avatarColor: currentUserAvatarColor,
        activeCell: null,
        cursorPosition: null,
        lastActivity: new Date().toISOString(),
        connectionStatus: 'online' as const,
      };
    }
    
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
      <div className={styles.leftSection}>
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
          {showMembersPanel && (
            <div className={styles.membersPanel}>
              <div className={styles.membersPanelHeader}>
                CURRENTLY VIEWING
              </div>
              <div className={styles.membersList}>
                {sortedPresenceUsers.map((user) => {
                  const isCurrentUser = user.userId === currentUserId;
                  return (
                    <div
                      key={user.userId}
                      className={`${styles.memberItem} ${isCurrentUser ? styles.memberItemHighlight : ''}`}
                    >
                      <Avatar
                        size={36}
                        style={{ backgroundColor: user.avatarColor }}
                      >
                        {getUserInitials(user.userName)}
                      </Avatar>
                      <div className={styles.memberInfo}>
                        <div className={styles.memberName}>
                          {user.userName} {isCurrentUser && <span className={styles.youLabel}>(you)</span>}
                        </div>
                        <div className={styles.memberEmail}>{user.userEmail}</div>
                      </div>
                      <div
                        className={styles.memberStatus}
                        style={{
                          backgroundColor: user.connectionStatus === 'online' ? '#52c41a' : '#faad14',
                        }}
                      />
                    </div>
                  );
                })}
                
                {sortedPresenceUsers.length === 0 && (
                  <div className={styles.emptyState}>
                    No one is currently viewing this library
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        {/* Share Button */}
        <div className={styles.shareSection}>
          <button
            className={styles.shareButton}
            onClick={() => setShowInviteModal(true)}
            >
              Share
          </button>
          <span className={styles.roleLabel}>{getRoleText(userRole)}</span>
        </div>

        {/* More Options Icon */}
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
        {/* Version Control Icon */}
        <Tooltip title="Version Control">
          <button className={styles.iconButton}>
            <Image
              src={libraryHeadVersionControlIcon}
              alt="Version Control"
              width={32}
              height={32}
            />
          </button>
        </Tooltip>
      </div>

      {/* Invite Collaborator Modal */}
      <InviteCollaboratorModal
        projectId={projectId}
        projectName={`Share ${libraryName}`}
        userRole={userRole}
        open={showInviteModal}
        onClose={() => setShowInviteModal(false)}
        onSuccess={() => {
          // Handle success (e.g., refresh collaborators list)
        }}
      />
    </div>
  );
}

