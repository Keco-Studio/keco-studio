'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSupabase } from '@/lib/SupabaseContext';
import { getFolder, Folder } from '@/lib/services/folderService';
import { listLibraries, Library } from '@/lib/services/libraryService';
import { LibraryCard } from '@/components/folders/LibraryCard';
import { LibraryListView } from '@/components/folders/LibraryListView';
import { LibraryToolbar } from '@/components/folders/LibraryToolbar';
import { NewLibraryModal } from '@/components/libraries/NewLibraryModal';
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

  // Listen for library creation events to refresh the list
  useEffect(() => {
    const handleLibraryCreated = (event: CustomEvent) => {
      const createdFolderId = event.detail?.folderId;
      // Only refresh if the library was created in the current folder
      if (!createdFolderId || createdFolderId === folderId) {
        fetchData();
      }
    };

    window.addEventListener('libraryCreated' as any, handleLibraryCreated as EventListener);
    
    return () => {
      window.removeEventListener('libraryCreated' as any, handleLibraryCreated as EventListener);
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
    // 功能暂不实现
  };

  const handleExport = (libraryId: string) => {
    // 功能暂不实现
    console.log('Export library:', libraryId);
  };

  const handleVersionHistory = (libraryId: string) => {
    // 功能暂不实现
    console.log('Version history:', libraryId);
  };

  const handleCreateBranch = (libraryId: string) => {
    // 功能暂不实现
    console.log('Create branch:', libraryId);
  };

  const handleRename = (libraryId: string) => {
    // 功能暂不实现
    console.log('Rename:', libraryId);
  };

  const handleDuplicate = (libraryId: string) => {
    // 功能暂不实现
    console.log('Duplicate:', libraryId);
  };

  const handleMoveTo = (libraryId: string) => {
    // 功能暂不实现
    console.log('Move to:', libraryId);
  };

  const handleDelete = (libraryId: string) => {
    // 功能暂不实现
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
      <div className={styles.header}>
        <h1 className={styles.title}>Resource Folder</h1>
      </div>
      <LibraryToolbar
        onCreateLibrary={handleCreateLibrary}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
      />
      {libraries.length === 0 ? (
        <div className={styles.emptyState}>
          <div className={styles.emptyText}>No libraries in this folder yet.</div>
        </div>
      ) : viewMode === 'grid' ? (
        <div className={styles.grid}>
          {libraries.map((library) => (
            <LibraryCard
              key={library.id}
              library={library}
              projectId={projectId}
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
          libraries={libraries}
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

