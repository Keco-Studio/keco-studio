/**
 * Version Control Sidebar Component
 * 
 * Displays version history panel on the right side of the screen
 * Based on Figma design: https://www.figma.com/design/IZqOPnDNNO1XZym901nqld/Keco-Studio-MVP-0.2?node-id=553-61431
 */

'use client';

import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSupabase } from '@/lib/SupabaseContext';
import { useLibraryData } from '@/lib/contexts/LibraryDataContext';
import { getVersionsByLibrary } from '@/lib/services/versionService';
import type { LibraryVersion } from '@/lib/types/version';
import type { AssetRow } from '@/lib/types/libraryAssets';
import { VersionList } from './VersionList';
import { CreateVersionModal } from './CreateVersionModal';
import styles from './VersionControlSidebar.module.css';
import Image from 'next/image';
import libraryAssetTableAddIcon from '@/assets/images/LibraryAssetTableAddIcon.svg';
import closeIcon from '@/assets/images/VersionBoardClose.svg';

interface VersionControlSidebarProps {
  libraryId: string;
  isOpen: boolean;
  onClose: () => void;
  selectedVersionId?: string | null;
  onVersionSelect?: (versionId: string | null) => void;
  onRestoreSuccess?: (restoredVersionId: string, snapshotData?: any) => void;
  highlightedVersionId?: string | null;
}

export function VersionControlSidebar({
  libraryId,
  isOpen,
  onClose,
  selectedVersionId,
  onVersionSelect,
  onRestoreSuccess,
  highlightedVersionId,
}: VersionControlSidebarProps) {
  const supabase = useSupabase();
  const queryClient = useQueryClient();
  const { allAssets } = useLibraryData();
  const [showCreateModal, setShowCreateModal] = useState(false);

  // 当前界面（Yjs）数据，用于创建版本时保证快照与「当前看到」一致
  const currentAssetsForVersion: AssetRow[] = allAssets.map((a) => ({
    id: a.id,
    libraryId: a.libraryId,
    name: a.name,
    propertyValues: a.propertyValues ?? {},
    created_at: a.created_at,
    rowIndex: a.rowIndex,
  }));

  // Fetch versions using React Query
  const {
    data: versions = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ['versions', libraryId],
    queryFn: () => getVersionsByLibrary(supabase, libraryId),
    enabled: isOpen && !!libraryId,
    staleTime: 30 * 1000, // 30 seconds
  });

  const handleCreateVersion = () => {
    setShowCreateModal(true);
  };

  const handleVersionCreated = () => {
    queryClient.invalidateQueries({ queryKey: ['versions', libraryId] });
    setShowCreateModal(false);
  };

  // Set up realtime subscription for version changes
  useEffect(() => {
    if (!isOpen || !libraryId) return;

    // console.log(`[VersionControlSidebar] Setting up realtime subscription for library: ${libraryId}`);

    // Subscribe to changes in library_versions table.
    // NOTE: No server-side filter on library_id because PostgreSQL's default
    // REPLICA IDENTITY only includes the primary key in DELETE events' `old` record,
    // so `filter: library_id=eq.xxx` silently drops DELETE events. Instead, we
    // listen to all events and filter client-side.
    const versionsChannel = supabase
      .channel(`library-versions:${libraryId}`)
      .on(
        'postgres_changes',
        {
          event: '*', // Listen to INSERT, UPDATE, DELETE
          schema: 'public',
          table: 'library_versions',
        },
        async (payload) => {
          // Client-side filter: only react to events for this library
          const newRecord = payload.new as any;
          const oldRecord = payload.old as any;
          const eventLibraryId = newRecord?.library_id || oldRecord?.library_id;
          // For DELETE, old record may only have the primary key (id), so if we
          // can't determine the library_id, refetch anyway to stay safe.
          if (eventLibraryId && eventLibraryId !== libraryId) return;

          queryClient.invalidateQueries({ queryKey: ['versions', libraryId] });
        }
      )
      .subscribe();

    // Cleanup on unmount or when libraryId/isOpen changes
    return () => {
      console.log(`[VersionControlSidebar] Cleaning up realtime subscription for library: ${libraryId}`);
      supabase.removeChannel(versionsChannel);
    };
  }, [libraryId, isOpen, supabase, queryClient]);

  if (!isOpen) return null;

  return (
    <>
      <div className={styles.sidebar}>
        {/* Header */}
        <div className={styles.header}>
          <h2 className={styles.title}>VERSION HISTORY</h2>
          <div className={styles.headerActions}>
            <button
              className={styles.addButton}
              onClick={handleCreateVersion}
              title="Create new version"
            >
              <Image src={libraryAssetTableAddIcon}
                alt="Add"
                width={24} height={24} className="icon-24"
              />
            </button>
            <button
              className={styles.closeButton}
              onClick={onClose}
              title="Close"
            >
              <Image src={closeIcon}
                alt="Close"
                width={24} height={24} className="icon-24"
              />
            </button>
          </div>
        </div>

        {/* Version List */}
        <div className={styles.content}>
          {isLoading ? (
            <div className={styles.loading}>Loading versions...</div>
          ) : error ? (
            <div className={styles.error}>Failed to load versions</div>
          ) : (
            <VersionList
              versions={versions}
              libraryId={libraryId}
              selectedVersionId={selectedVersionId}
              onVersionSelect={onVersionSelect}
              onRestoreSuccess={onRestoreSuccess}
              highlightedVersionId={highlightedVersionId}
            />
          )}
        </div>
      </div>

      {/* Create Version Modal */}
      <CreateVersionModal
        open={showCreateModal}
        libraryId={libraryId}
        currentAssetsFromClient={currentAssetsForVersion}
        onClose={() => setShowCreateModal(false)}
        onSuccess={handleVersionCreated}
      />
    </>
  );
}

