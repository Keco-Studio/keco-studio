/**
 * Version List Component
 * 
 * Displays list of versions sorted by creation time (newest first)
 */

'use client';

import { useMemo } from 'react';
import type { LibraryVersion } from '@/lib/types/version';
import { VersionItem } from './VersionItem';
import styles from './VersionList.module.css';

interface VersionListProps {
  versions: LibraryVersion[];
  libraryId: string;
  selectedVersionId?: string | null;
  onVersionSelect?: (versionId: string | null) => void;
  onRestoreSuccess?: () => void;
}

export function VersionList({ versions, libraryId, selectedVersionId, onVersionSelect, onRestoreSuccess }: VersionListProps) {
  // Sort versions by created_at DESC (newest first)
  const sortedVersions = useMemo(() => {
    return [...versions].sort((a, b) => 
      b.createdAt.getTime() - a.createdAt.getTime()
    );
  }, [versions]);

  if (sortedVersions.length === 0) {
    return (
      <div className={styles.emptyState}>
        No versions yet. Click the + button to create your first version.
      </div>
    );
  }

  return (
    <div className={styles.versionList}>
      {sortedVersions.map((version, index) => (
        <VersionItem
          key={version.id}
          version={version}
          libraryId={libraryId}
          isLast={index === sortedVersions.length - 1}
          isFirst={index === 0}
          isSelected={selectedVersionId === version.id}
          onSelect={onVersionSelect}
          onRestoreSuccess={onRestoreSuccess}
        />
      ))}
    </div>
  );
}

