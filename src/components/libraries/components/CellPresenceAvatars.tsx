'use client';

import React from 'react';
import { Tooltip } from 'antd';
import styles from '@/components/libraries/LibraryAssetsTable.module.css';

export type PresenceUser = {
  userId: string;
  userName: string;
  userEmail: string;
  avatarColor: string;
};

export type CellPresenceAvatarsProps = {
  users: PresenceUser[];
};

function getUserInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return '?';
  return parts[0].charAt(0).toUpperCase();
}

export const CellPresenceAvatars = React.memo<CellPresenceAvatarsProps>(function CellPresenceAvatars({
  users,
}) {
  if (users.length === 0) return null;

  const orderedUsers = [...users].reverse();
  const visibleUsers = orderedUsers.slice(0, 3);
  const hiddenCount = Math.max(0, orderedUsers.length - 3);

  return (
    <div className={styles.cellPresenceAvatars}>
      {visibleUsers.map((user) => (
        <Tooltip key={user.userId} title={user.userName} placement="top">
          <div
            className={styles.cellPresenceAvatar}
            style={{ backgroundColor: user.avatarColor }}
          >
            {getUserInitials(user.userName)}
          </div>
        </Tooltip>
      ))}
      {hiddenCount > 0 && (
        <Tooltip title={`${hiddenCount} more`} placement="top">
          <div className={styles.cellPresenceAvatar} style={{ backgroundColor: '#999' }}>
            +{hiddenCount}
          </div>
        </Tooltip>
      )}
    </div>
  );
});

export default CellPresenceAvatars;
