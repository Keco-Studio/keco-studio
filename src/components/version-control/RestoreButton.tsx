/**
 * Restore Button Component
 * 
 * Button to restore a version with hover tooltip
 */

'use client';

import { useState } from 'react';
import Image from 'next/image';
import { RestoreConfirmModal } from './RestoreConfirmModal';
import versionItemRestoreIcon from '@/assets/images/VersionItemRestoreIcon.svg';
import versionItemAlert from '@/assets/images/VersionItemAlert.svg';
import styles from './RestoreButton.module.css';

import type { LibraryVersion } from '@/lib/types/version';

interface RestoreButtonProps {
  version: LibraryVersion;
  libraryId: string;
  onRestoreSuccess?: (restoredVersionId: string) => void;
}

export function RestoreButton({ version, libraryId, onRestoreSuccess }: RestoreButtonProps) {
  const [showRestoreModal, setShowRestoreModal] = useState(false);

  return (
    <>
      <div className={styles.restoreButtonContainer}>
        <button
          className={styles.restoreButton}
          onClick={(e) => {
            e.stopPropagation();
            setShowRestoreModal(true);
          }}
        >
          <Image
            src={versionItemRestoreIcon}
            alt="Restore"
            width={24}
            height={24}
          />
        </button>
        <div className={styles.tooltip}>
          <Image
            src={versionItemAlert}
            alt="Restore"
            width={87}
            height={54}
          />
        </div>
      </div>

      <RestoreConfirmModal
        open={showRestoreModal}
        version={version}
        libraryId={libraryId}
        onClose={() => setShowRestoreModal(false)}
        onSuccess={(restoredVersionId) => {
          setShowRestoreModal(false);
          onRestoreSuccess?.(restoredVersionId);
        }}
      />
    </>
  );
}

