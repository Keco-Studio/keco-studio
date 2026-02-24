'use client';

import { Tooltip } from 'antd';
import styles from './FieldPresenceAvatars.module.css';

type User = {
  userId: string;
  userName: string;
  userEmail: string;
  avatarColor: string;
  activeCell: { assetId: string; propertyKey: string } | null;
  cursorPosition: { row: number; col: number } | null;
  lastActivity: string;
  connectionStatus: 'online' | 'away';
};

type FieldPresenceAvatarsProps = {
  users: User[];
  maxVisible?: number;
};

export function FieldPresenceAvatars({ users, maxVisible = 3 }: FieldPresenceAvatarsProps) {
  if (users.length === 0) return null;

  const getUserInitials = (name: string): string => {
    if (!name || name.trim() === '') return '?';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 0) return '?';
    return parts[0].charAt(0).toUpperCase();
  };

  // Reverse order: first user (rightmost) has priority - consistent with StackedAvatars
  const orderedUsers = [...users].reverse();
  const visibleUsers = orderedUsers.slice(0, maxVisible);
  const remainingCount = orderedUsers.length - maxVisible;

  return (
    <div className={styles.fieldPresenceAvatars}>
      {visibleUsers.map((user, index) => (
        <Tooltip key={user.userId} title={user.userName} placement="top">
          <div
            className={styles.fieldPresenceAvatar}
            style={{ 
              backgroundColor: user.avatarColor,
              zIndex: visibleUsers.length - index // First user (rightmost) has highest z-index
            }}
          >
            {getUserInitials(user.userName)}
          </div>
        </Tooltip>
      ))}
      {remainingCount > 0 && (
        <Tooltip
          title={orderedUsers
            .slice(maxVisible)
            .map((u) => u.userName)
            .join(', ')}
          placement="top"
        >
          <div className={styles.fieldPresenceAvatar} style={{ backgroundColor: '#6b7280' }}>
            +{remainingCount}
          </div>
        </Tooltip>
      )}
    </div>
  );
}

