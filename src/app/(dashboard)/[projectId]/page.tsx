'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSupabase } from '@/lib/SupabaseContext';
import { getProject, Project } from '@/lib/services/projectService';
import { listFolders, Folder } from '@/lib/services/folderService';
import { listLibraries, Library, getLibrariesAssetCounts } from '@/lib/services/libraryService';
import predefineSettingIcon from "@/app/assets/images/predefineSettingIcon.svg";
import Image from 'next/image';
import styles from './page.module.css';
import { FolderCard } from '@/components/folders/FolderCard';
import { LibraryCard } from '@/components/folders/LibraryCard';
import { LibraryListView } from '@/components/folders/LibraryListView';
import { LibraryToolbar } from '@/components/folders/LibraryToolbar';
import { NewLibraryModal } from '@/components/libraries/NewLibraryModal';
import { NewFolderModal } from '@/components/folders/NewFolderModal';

export default function ProjectPage() {
  const params = useParams();
  const router = useRouter();
  const supabase = useSupabase();
  const projectId = params.projectId as string;
  
  const [project, setProject] = useState<Project | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('grid');
  const [showLibraryModal, setShowLibraryModal] = useState(false);
  const [showFolderModal, setShowFolderModal] = useState(false);
  const [assetCounts, setAssetCounts] = useState<Record<string, number>>({}); 

  const fetchData = useCallback(async () => {
    if (!projectId) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const [projectData, foldersData, librariesData] = await Promise.all([
        getProject(supabase, projectId),
        listFolders(supabase, projectId),
        listLibraries(supabase, projectId, null), // Get only root libraries (folder_id is null)
      ]);
      
      if (!projectData) {
        setError('Project not found');
        return;
      }
      
      setProject(projectData);
      setFolders(foldersData);
      setLibraries(librariesData);
    } catch (e: any) {
      setError(e?.message || 'Failed to load project');
    } finally {
      setLoading(false);
    }
  }, [projectId, supabase]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Listen for folder and library creation/deletion events to refresh the list
  useEffect(() => {
    const handleFolderCreated = () => {
      fetchData();
    };

    const handleFolderDeleted = (event: CustomEvent) => {
      const deletedProjectId = event.detail?.projectId;
      // Only refresh if the folder was deleted from current project
      if (deletedProjectId === projectId) {
        fetchData();
      }
    };

    const handleLibraryCreated = (event: CustomEvent) => {
      const createdFolderId = event.detail?.folderId;
      // Only refresh if the library was created at root level (no folder)
      if (!createdFolderId) {
        fetchData();
      }
    };

    const handleLibraryDeleted = (event: CustomEvent) => {
      const deletedFolderId = event.detail?.folderId;
      const deletedProjectId = event.detail?.projectId;
      // Only refresh if the library was deleted from root level (no folder) and belongs to current project
      if (!deletedFolderId && deletedProjectId === projectId) {
        fetchData();
      }
    };

    window.addEventListener('folderCreated' as any, handleFolderCreated as EventListener);
    window.addEventListener('folderDeleted' as any, handleFolderDeleted as EventListener);
    window.addEventListener('libraryCreated' as any, handleLibraryCreated as EventListener);
    window.addEventListener('libraryDeleted' as any, handleLibraryDeleted as EventListener);
    
    return () => {
      window.removeEventListener('folderCreated' as any, handleFolderCreated as EventListener);
      window.removeEventListener('folderDeleted' as any, handleFolderDeleted as EventListener);
      window.removeEventListener('libraryCreated' as any, handleLibraryCreated as EventListener);
      window.removeEventListener('libraryDeleted' as any, handleLibraryDeleted as EventListener);
    };
  }, [fetchData, projectId]);

  
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


  const handleFolderClick = (folderId: string) => {
    router.push(`/${projectId}/folder/${folderId}`);
  };

  const handleFolderMoreClick = (folderId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    // Feature not implemented yet
  };

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

  const handleCreateFolder = () => {
    setShowFolderModal(true);
  };

  const handleCreateLibrary = () => {
    setShowLibraryModal(true);
  };

  const handleFolderCreated = () => {
    setShowFolderModal(false);
    fetchData();
    // Dispatch event to notify Sidebar
    window.dispatchEvent(new CustomEvent('folderCreated'));
  };

  const handleLibraryCreated = (libraryId: string) => {
    setShowLibraryModal(false);
    fetchData();
    // Dispatch event to notify Sidebar
    window.dispatchEvent(new CustomEvent('libraryCreated', {
      detail: { folderId: null, libraryId }
    }));
  };

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>Loading project...</div>
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

  if (!project) {
    return (
      <div className={styles.container}>
        <div className={styles.error}>Project not found</div>
      </div>
    );
  }

  const hasItems = folders.length > 0 || libraries.length > 0;

  return (
    <div className={styles.container}>
      {hasItems && (
        <LibraryToolbar
          mode="project"
          onCreateFolder={handleCreateFolder}
          onCreateLibrary={handleCreateLibrary}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
        />
      )}
      {!hasItems ? (
        <div className={styles.emptyState}>
          <div className={styles.emptyText}>No folders or libraries in this project yet.</div>
        </div>
      ) : viewMode === 'grid' ? (
        <div className={styles.grid}>
          {folders.map((folder) => (
            <FolderCard
              key={folder.id}
              folder={folder}
              projectId={projectId}
              onClick={handleFolderClick}
              onMoreClick={handleFolderMoreClick}
            />
          ))}
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
        folderId={null}
        onCreated={handleLibraryCreated}
      />
      <NewFolderModal
        open={showFolderModal}
        onClose={() => setShowFolderModal(false)}
        projectId={projectId}
        onCreated={handleFolderCreated}
      />
    </div>
  );
}

