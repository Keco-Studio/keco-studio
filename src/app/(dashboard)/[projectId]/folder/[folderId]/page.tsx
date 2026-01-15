'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSupabase } from '@/lib/SupabaseContext';
import { getFolder, Folder } from '@/lib/services/folderService';
import { listLibraries, Library, getLibrariesAssetCounts } from '@/lib/services/libraryService';
import { LibraryCard } from '@/components/folders/LibraryCard';
import { LibraryListView } from '@/components/folders/LibraryListView';
import { LibraryToolbar } from '@/components/folders/LibraryToolbar';
import { NewLibraryModal } from '@/components/libraries/NewLibraryModal';
import libraryEmptyIcon from '@/app/assets/images/libraryEmptyIcon.svg';
import plusHorizontal from '@/app/assets/images/plusHorizontal.svg';
import plusVertical from '@/app/assets/images/plusVertical.svg';
import Image from 'next/image';
import styles from './FolderPage.module.css';

export default function FolderPage() {
  const params = useParams();
  const router = useRouter();
  const supabase = useSupabase();
  const projectId = params.projectId as string;
  const folderId = params.folderId as string;
  
  const [folder, setFolder] = useState<Folder | null>(null);
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('grid');
  const [showLibraryModal, setShowLibraryModal] = useState(false);
  const [assetCounts, setAssetCounts] = useState<Record<string, number>>({});

  const fetchData = useCallback(async () => {
    if (!projectId || !folderId) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const [folderData, librariesData] = await Promise.all([
        getFolder(supabase, folderId),
        listLibraries(supabase, projectId, folderId),
      ]);
      
      if (!folderData) {
        setError('Folder not found');
        return;
      }
      
      setFolder(folderData);
      setLibraries(librariesData);
    } catch (e: any) {
      setError(e?.message || 'Failed to load folder');
    } finally {
      setLoading(false);
    }
  }, [projectId, folderId, supabase]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Fetch asset counts when libraries change
  useEffect(() => {
    async function fetchAssetCounts() {
      if (libraries.length > 0) {
        const libraryIds = libraries.map(lib => lib.id);
        const counts = await getLibrariesAssetCounts(supabase, libraryIds);
        setAssetCounts(counts);
      }
    }
    fetchAssetCounts();
  }, [libraries, supabase]);

  // Listen for library creation/deletion events and folder updates to refresh the list
  useEffect(() => {
    const handleLibraryCreated = (event: CustomEvent) => {
      const createdFolderId = event.detail?.folderId;
      // Only refresh if the library was created in the current folder
      if (createdFolderId === folderId) {
        fetchData();
      }
    };

    const handleLibraryDeleted = (event: CustomEvent) => {
      const deletedFolderId = event.detail?.folderId;
      // Only refresh if the library was deleted from the current folder
      if (deletedFolderId === folderId) {
        fetchData();
      }
    };

    const handleLibraryUpdated = (event: CustomEvent) => {
      // Refresh data when any library is updated
      // We need to check if the updated library belongs to the current folder
      // Since we don't have folderId in the event detail, we'll refresh all libraries
      // The fetchData will only fetch libraries for the current folder
      fetchData();
    };

    const handleFolderUpdated = (event: CustomEvent) => {
      const updatedFolderId = event.detail?.folderId;
      // Refresh if the current folder was updated
      if (updatedFolderId === folderId) {
        fetchData();
      }
    };

    window.addEventListener('libraryCreated' as any, handleLibraryCreated as EventListener);
    window.addEventListener('libraryDeleted' as any, handleLibraryDeleted as EventListener);
    window.addEventListener('libraryUpdated' as any, handleLibraryUpdated as EventListener);
    window.addEventListener('folderUpdated' as any, handleFolderUpdated as EventListener);
    
    return () => {
      window.removeEventListener('libraryCreated' as any, handleLibraryCreated as EventListener);
      window.removeEventListener('libraryDeleted' as any, handleLibraryDeleted as EventListener);
      window.removeEventListener('libraryUpdated' as any, handleLibraryUpdated as EventListener);
      window.removeEventListener('folderUpdated' as any, handleFolderUpdated as EventListener);
    };
  }, [folderId, fetchData]);

  const handleLibraryClick = (libraryId: string) => {
    router.push(`/${projectId}/${libraryId}`);
  };

  const handleLibrarySettingsClick = (libraryId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    router.push(`/${projectId}/${libraryId}/predefine`);
  };

  const handleLibraryMoreClick = (libraryId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    // Feature not implemented yet
  };

  const handleExport = (libraryId: string) => {
    // Feature not implemented yet
    console.log('Export library:', libraryId);
  };

  const handleVersionHistory = (libraryId: string) => {
    // Feature not implemented yet
    console.log('Version history:', libraryId);
  };

  const handleCreateBranch = (libraryId: string) => {
    // Feature not implemented yet
    console.log('Create branch:', libraryId);
  };

  const handleRename = (libraryId: string) => {
    // Feature not implemented yet
    console.log('Rename:', libraryId);
  };

  const handleDuplicate = (libraryId: string) => {
    // Feature not implemented yet
    console.log('Duplicate:', libraryId);
  };

  const handleMoveTo = (libraryId: string) => {
    // Feature not implemented yet
    console.log('Move to:', libraryId);
  };

  const handleDelete = (libraryId: string) => {
    // Feature not implemented yet
    console.log('Delete:', libraryId);
  };

  const handleCreateLibrary = () => {
    setShowLibraryModal(true);
  };

  const handleLibraryCreated = (libraryId: string) => {
    setShowLibraryModal(false);
    fetchData();
    // Dispatch event to notify Sidebar
    window.dispatchEvent(new CustomEvent('libraryCreated', {
      detail: { folderId, libraryId }
    }));
  };

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>Loading folder...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.container}>
        <div className={styles.error}>{error}</div>
      </div>
    );
  }

  if (!folder) {
    return (
      <div className={styles.container}>
        <div className={styles.error}>Folder not found</div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <LibraryToolbar
        mode="folder"
        title={folder?.name}
        onCreateLibrary={handleCreateLibrary}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
      />
      {libraries.length === 0 ? (
        <div className={styles.emptyStateWrapper}>
          <div className={styles.emptyStateContainer}>
            <div className={styles.emptyIcon}>
              <Image
                src={libraryEmptyIcon}
                alt="Library icon"
                width={72}
                height={72}
              />
            </div>
            <div className={styles.emptyText}>
              There is no any library here. you need to create a library firstly
            </div>
            <button
              className={styles.createLibraryButton}
              onClick={handleCreateLibrary}
            >
              <span className={styles.plusIcon}>
                <Image
                  src={plusHorizontal}
                  alt=""
                  width={17}
                  height={2}
                  className={styles.plusHorizontal}
                />
                <Image
                  src={plusVertical}
                  alt=""
                  width={2}
                  height={17}
                  className={styles.plusVertical}
                />
              </span>
              <span className={styles.buttonText}>Create Library</span>
            </button>
          </div>
        </div>
      ) : viewMode === 'grid' ? (
        <div className={styles.grid}>
          {libraries.map((library) => (
            <LibraryCard
              key={library.id}
              library={library}
              projectId={projectId}
              assetCount={assetCounts[library.id] || 0}
              onClick={handleLibraryClick}
              onSettingsClick={handleLibrarySettingsClick}
              onMoreClick={handleLibraryMoreClick}
              onExport={handleExport}
              onVersionHistory={handleVersionHistory}
              onCreateBranch={handleCreateBranch}
              onRename={handleRename}
              onDuplicate={handleDuplicate}
              onMoveTo={handleMoveTo}
              onDelete={handleDelete}
            />
          ))}
        </div>
      ) : (
        <LibraryListView
          libraries={libraries.map(lib => ({
            ...lib,
            assetCount: assetCounts[lib.id] || 0
          }))}
          projectId={projectId}
          onLibraryClick={handleLibraryClick}
          onSettingsClick={handleLibrarySettingsClick}
          onExport={handleExport}
          onVersionHistory={handleVersionHistory}
          onCreateBranch={handleCreateBranch}
          onRename={handleRename}
          onDuplicate={handleDuplicate}
          onMoveTo={handleMoveTo}
          onDelete={handleDelete}
        />
      )}
      <NewLibraryModal
        open={showLibraryModal}
        onClose={() => setShowLibraryModal(false)}
        projectId={projectId}
        folderId={folderId}
        onCreated={handleLibraryCreated}
      />
    </div>
  );
}

