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
  onRestoreSuccess?: (restoredVersionId: string) => void;
  highlightedVersionId?: string | null;
}

export function VersionList({ versions, libraryId, selectedVersionId, onVersionSelect, onRestoreSuccess, highlightedVersionId }: VersionListProps) {
  // Always show virtual current version at the top
  // Current version represents the current editing state, not a saved version
  // All versions from database are history versions
  const { currentVersion, historyVersions } = useMemo(() => {
    // Filter out any versions marked as current (shouldn't happen after fix, but just in case)
    const history = versions.filter(v => !v.isCurrent).sort((a, b) => 
      b.createdAt.getTime() - a.createdAt.getTime()
    );
    
    // Always create a virtual current version
    const virtualCurrent: LibraryVersion = {
      id: '__current__',
      libraryId: libraryId,
      versionName: 'Current Version',
      versionType: 'manual',
      createdBy: {
        id: '',
        name: 'System',
      },
      createdAt: new Date(),
      snapshotData: null,
      isCurrent: true,
    };
    
    return { currentVersion: virtualCurrent, historyVersions: history };
  }, [versions, libraryId]);

  // Combine: current version first, then history versions
  const allVersions = useMemo(() => {
    return [currentVersion, ...historyVersions];
  }, [currentVersion, historyVersions]);

  return (
    <div className={styles.versionList}>
      {allVersions.map((version, index) => {
        // Current version is selected when selectedVersionId is null
        const isCurrentSelected = version.id === '__current__' && selectedVersionId === null;
        const isVersionSelected = selectedVersionId === version.id;
        return (
          <VersionItem
            key={version.id}
            version={version}
            libraryId={libraryId}
            isLast={index === allVersions.length - 1}
            isFirst={index === 0}
            isSelected={isCurrentSelected || isVersionSelected}
            onSelect={onVersionSelect}
            onRestoreSuccess={onRestoreSuccess}
            isHighlighted={highlightedVersionId === version.id}
          />
        );
      })}
    </div>
  );
}

