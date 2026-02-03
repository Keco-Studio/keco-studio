'use client';

import React from 'react';
import Image from 'next/image';
import noassetIcon1 from '@/assets/images/NoassetIcon1.svg';
import noassetIcon2 from '@/assets/images/NoassetIcon2.svg';
import styles from '@/components/libraries/LibraryAssetsTable.module.css';

export type EmptyStateProps = {
  userRole: 'admin' | 'editor' | 'viewer' | null;
  onPredefineClick: () => void;
};

/**
 * Empty state when there are no properties (asset schema not set up).
 * Shows icon, message, and Predefine button for admin only.
 */
export function EmptyState({ userRole, onPredefineClick }: EmptyStateProps) {
  return (
    <div className={styles.tableContainer}>
      <div className={styles.emptyState}>
        <Image
          src={noassetIcon1}
          alt=""
          width={72}
          height={72}
          className={styles.emptyStateIcon}
        />
        <p className={styles.emptyStateText}>
          There is no any asset here. You need to create an asset firstly.
        </p>
        {userRole === 'admin' && (
          <button className={styles.predefineButton} onClick={onPredefineClick}>
            <Image
              src={noassetIcon2}
              alt=""
              width={24}
              height={24}
              className={`icon-24 ${styles.predefineButtonIcon}`}
            />
            <span>Predefine</span>
          </button>
        )}
      </div>
    </div>
  );
}
