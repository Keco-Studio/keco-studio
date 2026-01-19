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
import { getVersionsByLibrary } from '@/lib/services/versionService';
import type { LibraryVersion } from '@/lib/types/version';
import { VersionList } from './VersionList';
import { CreateVersionModal } from './CreateVersionModal';
import styles from './VersionControlSidebar.module.css';
import Image from 'next/image';
import libraryAssetTableAddIcon from '@/app/assets/images/LibraryAssetTableAddIcon.svg';
import closeIcon from '@/app/assets/images/VersionBoardClose.svg';

interface VersionControlSidebarProps {
  libraryId: string;
  isOpen: boolean;
  onClose: () => void;
}

export function VersionControlSidebar({
  libraryId,
  isOpen,
  onClose,
}: VersionControlSidebarProps) {
  const supabase = useSupabase();
  const queryClient = useQueryClient();
  const [showCreateModal, setShowCreateModal] = useState(false);

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

    console.log(`[VersionControlSidebar] Setting up realtime subscription for library: ${libraryId}`);

    // Subscribe to changes in library_versions table
    const versionsChannel = supabase
      .channel(`library-versions:${libraryId}`)
      .on(
        'postgres_changes',
        {
          event: '*', // Listen to INSERT, UPDATE, DELETE
          schema: 'public',
          table: 'library_versions',
          filter: `library_id=eq.${libraryId}`,
        },
        async (payload) => {
          console.log('[VersionControlSidebar] Version change detected:', payload);
          
          // Invalidate and refetch versions to get the latest data
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
              <Image
                src={libraryAssetTableAddIcon}
                alt="Add"
                width={24}
                height={24}
              />
            </button>
            <button
              className={styles.closeButton}
              onClick={onClose}
              title="Close"
            >
              <Image
                src={closeIcon}
                alt="Close"
                width={24}
                height={24}
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
            />
          )}
        </div>
      </div>

      {/* Create Version Modal */}
      <CreateVersionModal
        open={showCreateModal}
        libraryId={libraryId}
        onClose={() => setShowCreateModal(false)}
        onSuccess={handleVersionCreated}
      />
    </>
  );
}

