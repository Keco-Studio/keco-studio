/**
 * Overlapping presence avatars + expand panel (same UX as library table header).
 */

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Avatar, Tooltip } from 'antd';
import Image from 'next/image';
import { prependLocalUserWhenCollaborating } from '@/components/collaboration/collaborationAvatarDisplay';
import type { PresenceState } from '@/lib/types/collaboration';
import libraryHeadExpandCollaborators from '@/assets/images/libraryHeadExpandCollaborators.svg';
import styles from './PresenceMembersStack.module.css';

export type PresenceMembersStackProps = {
  presenceUsers: PresenceState[];
  currentUserId: string;
  currentUserName?: string;
  currentUserEmail?: string;
  currentUserAvatarColor?: string;
  emptyViewingMessage?: string;
  /** Accessibility label for the avatar group (documents keep e2e-friendly wording). */
  ariaLabel?: string;
};

function getUserInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

function truncateName(name: string, max = 10): string {
  return name.length > max ? `${name.slice(0, max)}...` : name;
}

export function PresenceMembersStack({
  presenceUsers,
  currentUserId,
  currentUserName = 'You',
  currentUserEmail = '',
  currentUserAvatarColor = '#999999',
  emptyViewingMessage = 'No one else is currently viewing',
  ariaLabel = 'Collaborators currently editing',
}: PresenceMembersStackProps) {
  const [showMembersPanel, setShowMembersPanel] = useState(false);
  const membersPanelRef = useRef<HTMLDivElement>(null);

  const sortedPresenceUsers = useMemo(() => {
    const remoteUsers = presenceUsers.filter((user) => user.userId !== currentUserId);
    const users = prependLocalUserWhenCollaborating(remoteUsers, {
      userId: currentUserId,
      userName: currentUserName,
      userEmail: currentUserEmail,
      avatarColor: currentUserAvatarColor,
      activeCell: null,
      cursorPosition: null,
      lastActivity: new Date().toISOString(),
      connectionStatus: 'online' as const,
    });

    return users.sort((a, b) => {
      if (a.userId === currentUserId) return -1;
      if (b.userId === currentUserId) return 1;
      return new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime();
    });
  }, [
    presenceUsers,
    currentUserId,
    currentUserName,
    currentUserEmail,
    currentUserAvatarColor,
  ]);

  const displayUsers = sortedPresenceUsers;
  const remainingCount = Math.max(0, sortedPresenceUsers.length - displayUsers.length);

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

  if (sortedPresenceUsers.length === 0) {
    return null;
  }

  const currentUser = sortedPresenceUsers.find((u) => u.userId === currentUserId);
  const otherUsers = sortedPresenceUsers.filter((u) => u.userId !== currentUserId);

  return (
    <div
      className={styles.membersSection}
      ref={membersPanelRef}
      data-testid="presence-members-stack"
    >
      <div className={styles.membersAvatars} aria-label={ariaLabel}>
        {displayUsers.map((user, index) => {
          const isLocal = user.userId === currentUserId;
          const title = isLocal ? `${user.userName} (you)` : `${user.userName} is editing`;
          return (
            <Tooltip key={user.userId} title={user.userName} placement="bottom">
              <Avatar
                size={30}
                className={styles.memberAvatar}
                title={title}
                style={{
                  backgroundColor: user.avatarColor,
                  zIndex: displayUsers.length - index,
                  marginLeft: index > 0 ? '-8px' : '0',
                }}
              >
                {getUserInitials(user.userName)}
              </Avatar>
            </Tooltip>
          );
        })}

        {remainingCount > 0 && (
          <Tooltip
            title={`${remainingCount} more ${remainingCount === 1 ? 'member' : 'members'}`}
            placement="bottom"
          >
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

      <Tooltip title="View all members">
        <button
          type="button"
          className={styles.expandCollaboratorsButton}
          onClick={() => setShowMembersPanel(!showMembersPanel)}
          aria-label="View all members"
        >
          <Image
            src={libraryHeadExpandCollaborators}
            alt="Expand"
            width={16}
            height={16}
            className="icon-16"
          />
        </button>
      </Tooltip>

      {showMembersPanel && (
        <div className={styles.membersPanel}>
          {currentUser && (
            <div className={styles.currentUserSection}>
              <div className={styles.currentUserItem}>
                <Avatar
                  size={30}
                  style={{ backgroundColor: currentUser.avatarColor }}
                >
                  {getUserInitials(currentUser.userName)}
                </Avatar>
                <div className={styles.memberInfo}>
                  <Tooltip title={currentUser.userName}>
                    <div className={styles.memberName}>
                      {truncateName(currentUser.userName)}{' '}
                      <span className={styles.youLabel}>(you)</span>
                    </div>
                  </Tooltip>
                </div>
              </div>
            </div>
          )}

          <div className={styles.membersPanelHeader}>CURRENTLY VIEWING</div>
          <div className={styles.membersList}>
            {otherUsers.length > 0 ? (
              otherUsers.map((user) => (
                <div key={user.userId} className={styles.memberItem}>
                  <Avatar
                    size={30}
                    className={styles.memberAvatar}
                    style={{ backgroundColor: user.avatarColor }}
                  >
                    {getUserInitials(user.userName)}
                  </Avatar>
                  <div className={styles.memberInfo}>
                    <Tooltip title={user.userName}>
                      <div className={styles.memberName}>{truncateName(user.userName)}</div>
                    </Tooltip>
                  </div>
                </div>
              ))
            ) : (
              <div className={styles.emptyState}>{emptyViewingMessage}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
