/**
 * PresenceIndicators Component
 * 
 * Displays active collaborators in the library with their avatars.
 * Features:
 * - Shows up to 10 avatars with "+X others" for overflow
 * - Color-coded avatars matching user presence
 * - Tooltips showing user name and activity
 * - Real-time updates as users join/leave
 */

'use client';

import React from 'react';
import { Avatar, Tooltip } from 'antd';
import { UserOutlined } from '@ant-design/icons';
import type { PresenceState } from '@/lib/types/collaboration';
import { formatRelativeTime } from '@/lib/utils/dateTime';
import styles from './PresenceIndicators.module.css';

export type PresenceIndicatorsProps = {
  presenceUsers: PresenceState[];
  maxVisible?: number;
  size?: number | 'small' | 'default' | 'large';
  className?: string;
};

export function PresenceIndicators({
  presenceUsers,
  maxVisible = 10,
  size = 'default',
  className = '',
}: PresenceIndicatorsProps) {
  // Sort users by last activity (most recent first)
  const sortedUsers = [...presenceUsers].sort((a, b) => {
    return new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime();
  });

  const visibleUsers = sortedUsers.slice(0, maxVisible);
  const hiddenCount = Math.max(0, sortedUsers.length - maxVisible);

  if (sortedUsers.length === 0) {
    return null;
  }

  /**
   * Get user initials from name
   */
  const getUserInitials = (name: string): string => {
    const parts = name.trim().split(/\s+/);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
  };

  /**
   * Format last activity time using timezone-aware utility
   */
  const formatLastActivity = (timestamp: string): string => {
    return formatRelativeTime(new Date(timestamp));
  };

  /**
   * Get tooltip content for a user
   */
  const getUserTooltip = (user: PresenceState): React.ReactNode => {
    return (
      <div className={styles.tooltipContent}>
        <div className={styles.tooltipName}>{user.userName}</div>
        <div className={styles.tooltipActivity}>
          Active {formatLastActivity(user.lastActivity)}
        </div>
        {user.activeCell && (
          <div className={styles.tooltipEditing}>
            Editing a cell
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={`${styles.presenceIndicators} ${className}`}>
      <div className={styles.label}>Active collaborators:</div>
      <div className={styles.avatarGroup}>
        {visibleUsers.map((user) => (
          <Tooltip
            key={user.userId}
            title={getUserTooltip(user)}
            placement="bottom"
            overlayClassName={styles.presenceTooltip}
          >
            <Avatar
              size={size}
              className={styles.avatar}
              style={{
                backgroundColor: user.avatarColor,
                cursor: 'pointer',
              }}
            >
              {getUserInitials(user.userName)}
            </Avatar>
          </Tooltip>
        ))}
        
        {hiddenCount > 0 && (
          <Tooltip
            title={`${hiddenCount} more ${hiddenCount === 1 ? 'person' : 'people'} active`}
            placement="bottom"
          >
            <Avatar
              size={size}
              className={`${styles.avatar} ${styles.avatarOverflow}`}
            >
              +{hiddenCount}
            </Avatar>
          </Tooltip>
        )}
      </div>
    </div>
  );
}

