/**
 * StackedAvatars Component
 * 
 * Displays multiple user avatars stacked horizontally when multiple users
 * are editing the same cell.
 * Features:
 * - First user's avatar shown rightmost (priority)
 * - Subsequent users stacked to the left
 * - Tooltips showing user names
 * - Color-coded avatars matching user presence
 */

'use client';

import React from 'react';
import { Avatar, Tooltip } from 'antd';
import type { PresenceState } from '@/lib/types/collaboration';
import styles from './StackedAvatars.module.css';

export type StackedAvatarsProps = {
  users: PresenceState[];
  size?: number | 'small' | 'default' | 'large';
  maxVisible?: number;
  className?: string;
  borderColor?: string; // Optional: Use first user's color for cell border
};

export function StackedAvatars({
  users,
  size = 'small',
  maxVisible = 3,
  className = '',
  borderColor,
}: StackedAvatarsProps) {
  if (users.length === 0) {
    return null;
  }

  // Reverse order: first user (rightmost) has priority
  const orderedUsers = [...users].reverse();
  const visibleUsers = orderedUsers.slice(0, maxVisible);
  const hiddenCount = Math.max(0, orderedUsers.length - maxVisible);

  /**
   * Get user initials from name
   */
  const getUserInitials = (name: string): string => {
    const parts = name.trim().split(/\s+/);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
  };

  return (
    <div className={`${styles.stackedAvatars} ${className}`}>
      {visibleUsers.map((user, index) => (
        <Tooltip
          key={user.userId}
          title={user.userName}
          placement="top"
        >
          <Avatar
            size={size}
            className={styles.avatar}
            style={{
              backgroundColor: user.avatarColor,
              zIndex: visibleUsers.length - index, // First user (rightmost) has highest z-index
            }}
          >
            {getUserInitials(user.userName)}
          </Avatar>
        </Tooltip>
      ))}
      
      {hiddenCount > 0 && (
        <Tooltip
          title={`${hiddenCount} more ${hiddenCount === 1 ? 'person' : 'people'} editing`}
          placement="top"
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
  );
}

/**
 * Get the border color for a cell with multiple editors.
 * Uses the first user's (rightmost avatar) color.
 */
export function getFirstUserColor(users: PresenceState[]): string | undefined {
  if (users.length === 0) return undefined;
  // First user in the array has priority
  return users[0].avatarColor;
}

