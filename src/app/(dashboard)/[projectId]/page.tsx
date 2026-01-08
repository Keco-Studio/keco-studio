'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSupabase } from '@/lib/SupabaseContext';
import { getProject, Project } from '@/lib/services/projectService';
import { listFolders, Folder } from '@/lib/services/folderService';
import { listLibraries, Library, getLibrariesAssetCounts } from '@/lib/services/libraryService';
import { AuthorizationError } from '@/lib/services/authorizationService';
import predefineSettingIcon from "@/app/assets/images/predefineSettingIcon.svg";
import projectNoFolderPreIcon from "@/app/assets/images/projectNoFolderPreIcon.svg";
import plusHorizontal from "@/app/assets/images/plusHorizontal.svg";
import plusVertical from "@/app/assets/images/plusVertical.svg";
import Image from 'next/image';
import styles from './page.module.css';
import { FolderCard } from '@/components/folders/FolderCard';
import { LibraryCard } from '@/components/folders/LibraryCard';
import { LibraryListView } from '@/components/folders/LibraryListView';
import { LibraryToolbar } from '@/components/folders/LibraryToolbar';
import { NewLibraryModal } from '@/components/libraries/NewLibraryModal';
import { NewFolderModal } from '@/components/folders/NewFolderModal';
import { AddLibraryMenu } from '@/components/libraries/AddLibraryMenu';

export default function ProjectPage() {
  const params = useParams();
  const router = useRouter();
  const supabase = useSupabase();
  const projectId = params.projectId as string;
  
  const [project, setProject] = useState<Project | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [folderLibraries, setFolderLibraries] = useState<Record<string, Library[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('grid');
  const [showLibraryModal, setShowLibraryModal] = useState(false);
  const [showFolderModal, setShowFolderModal] = useState(false);
  const [assetCounts, setAssetCounts] = useState<Record<string, number>>({}); 
  const [showCreateMenu, setShowCreateMenu] = useState(false);
  const [createButtonRef, setCreateButtonRef] = useState<HTMLButtonElement | null>(null); 

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
        // Project not found - redirect immediately without showing error
        // Use window.location for immediate redirect to prevent any flash of content
        window.location.replace('/projects');
        return;
      }
      
      // Fetch libraries for each folder
      const folderLibrariesMap: Record<string, Library[]> = {};
      await Promise.all(
        foldersData.map(async (folder) => {
          const libs = await listLibraries(supabase, projectId, folder.id);
          folderLibrariesMap[folder.id] = libs;
        })
      );
      
      setProject(projectData);
      setFolders(foldersData);
      setLibraries(librariesData);
      setFolderLibraries(folderLibrariesMap);
      setLoading(false);
    } catch (e: any) {
      // If it's an authorization error, redirect immediately without showing error
      // This provides better UX and security (no flash of error message)
      if (e instanceof AuthorizationError || e?.name === 'AuthorizationError' || 
          e?.message?.includes('Unauthorized')) {
        // Use window.location for immediate redirect to prevent any flash of content
        window.location.replace('/projects');
        return;
      }
      
      // For "not found" errors, also redirect (due to RLS, this means unauthorized)
      // But we keep it generic to avoid information leakage
      if (e?.message?.includes('not found')) {
        // Use window.location for immediate redirect
        window.location.replace('/projects');
        return;
      }
      
      // For other unexpected errors, show error message
      setError(e?.message || 'Failed to load project');
      setLoading(false);
    }
  }, [projectId, supabase]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Listen for folder and library creation/deletion events to refresh the list
  useEffect(() => {
    const handleFolderCreated = (event: CustomEvent) => {
      // 只刷新当前项目的数据，避免重复请求
      const eventProjectId = event.detail?.projectId;
      if (!eventProjectId || eventProjectId === projectId) {
        fetchData();
      }
    };

    const handleFolderDeleted = (event: CustomEvent) => {
      const deletedProjectId = event.detail?.projectId;
      // Only refresh if the folder was deleted from current project
      if (deletedProjectId === projectId) {
        fetchData();
      }
    };

    const handleFolderUpdated = (event: CustomEvent) => {
      // Refresh data when any folder is updated in the current project
      // We refresh all folders to ensure the updated folder name is reflected
      fetchData();
    };

    const handleLibraryCreated = (event: CustomEvent) => {
      // 只刷新当前项目的数据，避免重复请求
      const eventProjectId = event.detail?.projectId;
      if (!eventProjectId || eventProjectId === projectId) {
        fetchData();
      }
    };

    const handleLibraryDeleted = (event: CustomEvent) => {
      const deletedProjectId = event.detail?.projectId;
      // Refresh data if the library was deleted from current project
      if (deletedProjectId === projectId) {
        fetchData();
      }
    };

    const handleLibraryUpdated = (event: CustomEvent) => {
      // Refresh data when any library is updated in the current project
      // We refresh all libraries to ensure the updated library name is reflected in FolderCard
      fetchData();
    };

    window.addEventListener('folderCreated' as any, handleFolderCreated as EventListener);
    window.addEventListener('folderDeleted' as any, handleFolderDeleted as EventListener);
    window.addEventListener('folderUpdated' as any, handleFolderUpdated as EventListener);
    window.addEventListener('libraryCreated' as any, handleLibraryCreated as EventListener);
    window.addEventListener('libraryDeleted' as any, handleLibraryDeleted as EventListener);
    window.addEventListener('libraryUpdated' as any, handleLibraryUpdated as EventListener);
    
    return () => {
      window.removeEventListener('folderCreated' as any, handleFolderCreated as EventListener);
      window.removeEventListener('folderDeleted' as any, handleFolderDeleted as EventListener);
      window.removeEventListener('folderUpdated' as any, handleFolderUpdated as EventListener);
      window.removeEventListener('libraryCreated' as any, handleLibraryCreated as EventListener);
      window.removeEventListener('libraryDeleted' as any, handleLibraryDeleted as EventListener);
      window.removeEventListener('libraryUpdated' as any, handleLibraryUpdated as EventListener);
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
    // 只发送事件，让所有监听器统一刷新，避免重复请求
    // 事件监听器会检查 projectId 并刷新当前页面的数据
    window.dispatchEvent(new CustomEvent('folderCreated', {
      detail: { projectId }
    }));
  };

  const handleLibraryCreated = (libraryId: string) => {
    setShowLibraryModal(false);
    // 只发送事件，让所有监听器统一刷新，避免重复请求
    // 事件监听器会检查 projectId 并刷新当前页面的数据
    window.dispatchEvent(new CustomEvent('libraryCreated', {
      detail: { folderId: null, libraryId, projectId }
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
      <LibraryToolbar
        mode="project"
        title={project?.name}
        onCreateFolder={handleCreateFolder}
        onCreateLibrary={handleCreateLibrary}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
      />
      {!hasItems ? (
        <div className={styles.emptyState}>
          <Image
            src={projectNoFolderPreIcon}
            alt="No folders or libraries"
            width={72}
            height={72}
            className={styles.emptyIcon}
          />
          <div className={styles.emptyText}>There is no any folder or library here in this project yet.</div>
          <button
            ref={setCreateButtonRef}
            className={styles.createButton}
            onClick={() => setShowCreateMenu(!showCreateMenu)}
            aria-label="Create Folder/Library"
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
            <span className={styles.createButtonText}>Create</span>
          </button>
          <AddLibraryMenu
            open={showCreateMenu}
            anchorElement={createButtonRef}
            onClose={() => setShowCreateMenu(false)}
            onCreateFolder={handleCreateFolder}
            onCreateLibrary={handleCreateLibrary}
          />
        </div>
      ) : viewMode === 'grid' ? (
        <div className={styles.grid}>
          {folders.map((folder) => (
            <FolderCard
              key={folder.id}
              folder={folder}
              projectId={projectId}
              libraries={folderLibraries[folder.id] || []}
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

