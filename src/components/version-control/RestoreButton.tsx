/**
 * Restore Button Component
 * 
 * Button to restore a version with hover tooltip
 */

'use client';

import { useState } from 'react';
import { Tooltip } from 'antd';
import { RestoreConfirmModal } from './RestoreConfirmModal';
import styles from './RestoreButton.module.css';

import type { LibraryVersion } from '@/lib/types/version';

interface RestoreButtonProps {
  version: LibraryVersion;
  libraryId: string;
}

export function RestoreButton({ version, libraryId }: RestoreButtonProps) {
  const [showRestoreModal, setShowRestoreModal] = useState(false);

  return (
    <>
      <Tooltip title="Restore" placement="top">
        <button
          className={styles.restoreButton}
          onClick={(e) => {
            e.stopPropagation();
            setShowRestoreModal(true);
          }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M8 2L3 7H6V12H10V7H13L8 2Z"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </Tooltip>

      <RestoreConfirmModal
        open={showRestoreModal}
        version={version}
        libraryId={libraryId}
        onClose={() => setShowRestoreModal(false)}
        onSuccess={() => {
          setShowRestoreModal(false);
        }}
      />
    </>
  );
}

