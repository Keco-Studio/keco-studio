'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter, usePathname } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSupabase } from '@/lib/SupabaseContext';
import { queryKeys } from '@/lib/utils/queryKeys';
import { getProject, Project } from '@/lib/services/projectService';
import { listFolders, Folder } from '@/lib/services/folderService';
import { listLibraries, Library, getLibrariesAssetCounts } from '@/lib/services/libraryService';
import { AuthorizationError, getUserProjectRole } from '@/lib/services/authorizationService';
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
import { EditLibraryModal } from '@/components/libraries/EditLibraryModal';
import { NewFolderModal } from '@/components/folders/NewFolderModal';
import { EditFolderModal } from '@/components/folders/EditFolderModal';
import { AddLibraryMenu } from '@/components/libraries/AddLibraryMenu';
import { ContextMenuAction } from '@/components/layout/ContextMenu';
import { deleteLibrary } from '@/lib/services/libraryService';
import { deleteFolder } from '@/lib/services/folderService';

export default function ProjectPage() {
  const params = useParams();
  const router = useRouter();
  const pathname = usePathname();
  const supabase = useSupabase();
  const queryClient = useQueryClient();
  const projectId = params.projectId as string;
    
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('grid');
  const [showLibraryModal, setShowLibraryModal] = useState(false);
  const [showFolderModal, setShowFolderModal] = useState(false);
  const [showEditLibraryModal, setShowEditLibraryModal] = useState(false);
  const [showEditFolderModal, setShowEditFolderModal] = useState(false);
  const [editingLibraryId, setEditingLibraryId] = useState<string | null>(null);
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [assetCounts, setAssetCounts] = useState<Record<string, number>>({}); 
  const [showCreateMenu, setShowCreateMenu] = useState(false);
  const [createButtonRef, setCreateButtonRef] = useState<HTMLButtonElement | null>(null);
  const [userRole, setUserRole] = useState<'admin' | 'editor' | 'viewer' | null>(null); 

  // Use React Query for data fetching
  const { data: project, isLoading: projectLoading, error: projectError } = useQuery({
    queryKey: queryKeys.project(projectId),
    queryFn: async () => {
      const data = await getProject(supabase, projectId);
      if (!data) {
        window.location.replace('/projects');
        return null;
      }
      return data;
    },
    enabled: !!projectId,
  });

  const { data: folders = [], isLoading: foldersLoading } = useQuery({
    queryKey: queryKeys.projectFolders(projectId),
    queryFn: () => listFolders(supabase, projectId),
    enabled: !!projectId,
  });

  const { data: libraries = [], isLoading: librariesLoading } = useQuery({
    queryKey: queryKeys.projectLibraries(projectId),
    queryFn: () => listLibraries(supabase, projectId, null),
    enabled: !!projectId,
  });

  // Fetch all folder libraries in one query to avoid hooks violation
  const [folderLibraries, setFolderLibraries] = useState<Record<string, Library[]>>({});
  
  useEffect(() => {
    const fetchFolderLibraries = async () => {
      if (!projectId || folders.length === 0) return;
      
      const folderLibrariesMap: Record<string, Library[]> = {};
      await Promise.all(
        folders.map(async (folder) => {
          const libs = await listLibraries(supabase, projectId, folder.id);
          folderLibrariesMap[folder.id] = libs;
        })
      );
      setFolderLibraries(folderLibrariesMap);
    };
    
    fetchFolderLibraries();
  }, [projectId, folders, supabase]);

  const loading = projectLoading || foldersLoading || librariesLoading;
  const error = projectError ? (projectError as any)?.message || 'Failed to load project' : null;

  // Handle authorization errors
  useEffect(() => {
    if (projectError) {
      const err = projectError as any;
      if (err instanceof AuthorizationError || err?.name === 'AuthorizationError' || 
          err?.message?.includes('Unauthorized') || err?.message?.includes('not found')) {
        window.location.replace('/projects');
      }
    }
  }, [projectError]);

  // Fetch user role in current project
  useEffect(() => {
    const fetchUserRole = async () => {
      if (!projectId) {
        setUserRole(null);
        return;
      }
      
      try {
        const role = await getUserProjectRole(supabase, projectId);
        setUserRole(role);
      } catch (error) {
        console.error('[ProjectPage] Error fetching user role:', error);
        setUserRole(null);
      }
    };
    
    fetchUserRole();
  }, [projectId, supabase]);

  // Optimized event handlers with targeted cache invalidation
  useEffect(() => {
    const handleFolderCreated = (event: CustomEvent) => {
      const eventProjectId = event.detail?.projectId;
      if (!eventProjectId || eventProjectId === projectId) {
        // Only invalidate folders list, not everything
        queryClient.invalidateQueries({ queryKey: queryKeys.projectFolders(projectId) });
      }
    };

    const handleFolderDeleted = (event: CustomEvent) => {
      const deletedProjectId = event.detail?.projectId;
      if (deletedProjectId === projectId) {
        // Invalidate folders list
        queryClient.invalidateQueries({ queryKey: queryKeys.projectFolders(projectId) });
      }
    };

    const handleFolderUpdated = (event: CustomEvent) => {
      const folderId = event.detail?.folderId;
      // Only invalidate the specific folder, not all folders
      if (folderId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.folder(folderId) });
      }
      // Also invalidate folders list to update the name
      queryClient.invalidateQueries({ queryKey: queryKeys.projectFolders(projectId) });
    };

    const handleLibraryCreated = async (event: CustomEvent) => {
      const eventProjectId = event.detail?.projectId;
      const folderId = event.detail?.folderId;
      if (!eventProjectId || eventProjectId === projectId) {
        // Invalidate appropriate libraries list
        if (folderId) {
          queryClient.invalidateQueries({ queryKey: queryKeys.folderLibraries(folderId) });
          // Also refresh folderLibraries state for the specific folder
          const libs = await listLibraries(supabase, projectId, folderId);
          setFolderLibraries(prev => ({ ...prev, [folderId]: libs }));
        } else {
          queryClient.invalidateQueries({ queryKey: queryKeys.projectLibraries(projectId) });
        }
      }
    };

    const handleLibraryDeleted = async (event: CustomEvent) => {
      const deletedProjectId = event.detail?.projectId;
      const folderId = event.detail?.folderId;
      if (deletedProjectId === projectId) {
        // Invalidate appropriate libraries list
        if (folderId) {
          queryClient.invalidateQueries({ queryKey: queryKeys.folderLibraries(folderId) });
          // Also refresh folderLibraries state for the specific folder
          const libs = await listLibraries(supabase, projectId, folderId);
          setFolderLibraries(prev => ({ ...prev, [folderId]: libs }));
        } else {
          queryClient.invalidateQueries({ queryKey: queryKeys.projectLibraries(projectId) });
        }
      }
    };

    const handleLibraryUpdated = async (event: CustomEvent) => {
      const libraryId = event.detail?.libraryId;
      // Only invalidate the specific library
      if (libraryId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.library(libraryId) });
      }
      // Also invalidate libraries lists to update the name
      queryClient.invalidateQueries({ queryKey: queryKeys.projectLibraries(projectId) });
      // Invalidate all folder libraries to catch any folder-based libraries
      folders.forEach(folder => {
        queryClient.invalidateQueries({ queryKey: queryKeys.folderLibraries(folder.id) });
      });
      // Refresh folderLibraries state to update names
      const folderLibrariesMap: Record<string, Library[]> = {};
      await Promise.all(
        folders.map(async (folder) => {
          const libs = await listLibraries(supabase, projectId, folder.id);
          folderLibrariesMap[folder.id] = libs;
        })
      );
      setFolderLibraries(folderLibrariesMap);
    };

    const handleProjectUpdated = async (event: CustomEvent) => {
      const updatedProjectId = event.detail?.projectId;
      if (updatedProjectId === projectId) {
        console.log('[ProjectPage] Project updated, refreshing data...');
        
        // CRITICAL: Must invalidate globalRequestCache first!
        const { globalRequestCache } = await import('@/lib/hooks/useRequestCache');
        globalRequestCache.invalidate(`project:${projectId}`);
        globalRequestCache.invalidate(`project:name:${projectId}`);
        console.log('[ProjectPage] ✅ globalRequestCache invalidated');
        
        // Only invalidate project data, not folders or libraries
        await queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) });
        await queryClient.refetchQueries({ 
          queryKey: queryKeys.project(projectId),
          type: 'active',
        });
        console.log('[ProjectPage] ✅ Project data refreshed');
      }
    };

    window.addEventListener('folderCreated' as any, handleFolderCreated as EventListener);
    window.addEventListener('folderDeleted' as any, handleFolderDeleted as EventListener);
    window.addEventListener('folderUpdated' as any, handleFolderUpdated as EventListener);
    window.addEventListener('libraryCreated' as any, handleLibraryCreated as EventListener);
    window.addEventListener('libraryDeleted' as any, handleLibraryDeleted as EventListener);
    window.addEventListener('libraryUpdated' as any, handleLibraryUpdated as EventListener);
    window.addEventListener('projectUpdated' as any, handleProjectUpdated as EventListener);
    
    return () => {
      window.removeEventListener('folderCreated' as any, handleFolderCreated as EventListener);
      window.removeEventListener('folderDeleted' as any, handleFolderDeleted as EventListener);
      window.removeEventListener('folderUpdated' as any, handleFolderUpdated as EventListener);
      window.removeEventListener('libraryCreated' as any, handleLibraryCreated as EventListener);
      window.removeEventListener('libraryDeleted' as any, handleLibraryDeleted as EventListener);
      window.removeEventListener('libraryUpdated' as any, handleLibraryUpdated as EventListener);
      window.removeEventListener('projectUpdated' as any, handleProjectUpdated as EventListener);
    };
  }, [queryClient, projectId, folders]);

  
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

  const handleLibraryAction = async (libraryId: string, action: ContextMenuAction) => {
    switch (action) {
      case 'rename':
        setEditingLibraryId(libraryId);
        setShowEditLibraryModal(true);
        break;
      case 'delete':
        if (window.confirm('Delete this library?')) {
          try {
            // Get library info before deleting to notify proper events
            const libraryToDelete = libraries.find(lib => lib.id === libraryId);
            const deletedFolderId = libraryToDelete?.folder_id || null;
            
            await deleteLibrary(supabase, libraryId);
            
            // Invalidate appropriate cache
            if (deletedFolderId) {
              queryClient.invalidateQueries({ queryKey: queryKeys.folderLibraries(deletedFolderId) });
            } else {
              queryClient.invalidateQueries({ queryKey: queryKeys.projectLibraries(projectId) });
            }
            
            // Dispatch event to notify Sidebar
            window.dispatchEvent(new CustomEvent('libraryDeleted', {
              detail: { folderId: deletedFolderId, libraryId, projectId }
            }));
            
            // If viewing this library, navigate to project
            if (pathname.includes(libraryId)) {
              router.push(`/${projectId}`);
            }
          } catch (err: any) {
            console.error('Failed to delete library:', err);
            alert(err?.message || 'Failed to delete library');
          }
        }
        break;
      default:
        console.log('Library action not implemented:', action);
    }
  };

  const handleFolderAction = async (folderId: string, action: ContextMenuAction) => {
    switch (action) {
      case 'rename':
        setEditingFolderId(folderId);
        setShowEditFolderModal(true);
        break;
      case 'delete':
        if (window.confirm('Delete this folder? All libraries under it will be removed.')) {
          try {
            await deleteFolder(supabase, folderId);
            
            // Invalidate folders list
            queryClient.invalidateQueries({ queryKey: queryKeys.projectFolders(projectId) });
            // Also invalidate the folder libraries
            queryClient.invalidateQueries({ queryKey: queryKeys.folderLibraries(folderId) });
            
            // Dispatch event to notify Sidebar
            window.dispatchEvent(new CustomEvent('folderDeleted', {
              detail: { folderId, projectId }
            }));
            
            // If viewing this folder, navigate to project
            if (pathname.includes(`/folder/${folderId}`)) {
              router.push(`/${projectId}`);
            }
          } catch (err: any) {
            console.error('Failed to delete folder:', err);
            alert(err?.message || 'Failed to delete folder');
          }
        }
        break;
      default:
        console.log('Folder action not implemented:', action);
    }
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
  
  // Only admin can create folders and libraries
  const canCreate = userRole === 'admin';

  return (
    <div className={styles.container}>
      <LibraryToolbar
        mode="project"
        title={project?.name}
        onCreateFolder={handleCreateFolder}
        onCreateLibrary={handleCreateLibrary}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        userRole={userRole}
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
          {canCreate && (
            <>
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
            </>
          )}
        </div>
      ) : viewMode === 'grid' ? (
        <div className={styles.grid}>
          {folders.map((folder) => (
            <FolderCard
              key={folder.id}
              folder={folder}
              projectId={projectId}
              libraries={folderLibraries[folder.id] || []}
              userRole={userRole}
              onClick={handleFolderClick}
              onAction={handleFolderAction}
            />
          ))}
          {libraries.map((library) => (
            <LibraryCard
              key={library.id}
              library={library}
              projectId={projectId}
              assetCount={assetCounts[library.id] || 0} 
              userRole={userRole}
              onClick={handleLibraryClick}
              onSettingsClick={handleLibrarySettingsClick}
              onAction={handleLibraryAction}
            />
          ))}
        </div>
      ) : (
        <LibraryListView
          folders={folders.map(folder => {
            const libs = folderLibraries[folder.id] || [];
            // Find the library with the most recent data update in this folder
            let mostRecentLibrary = null;
            let mostRecentDate = folder.updated_at;
            
            for (const lib of libs) {
              const libUpdateDate = lib.last_data_updated_at || lib.updated_at;
              if (new Date(libUpdateDate) > new Date(mostRecentDate)) {
                mostRecentDate = libUpdateDate;
                mostRecentLibrary = lib;
              }
            }
            
            return {
              ...folder,
              libraryCount: libs.length,
              // Use the most recent data update time and user from libraries in folder
              last_data_updated_at: mostRecentDate,
              data_updater: mostRecentLibrary ? mostRecentLibrary.data_updater : folder.updater,
            };
          })}
          libraries={libraries.map(lib => ({
            ...lib,
            assetCount: assetCounts[lib.id] || 0
          }))}
          projectId={projectId}
          userRole={userRole}
          onFolderClick={handleFolderClick}
          onLibraryClick={handleLibraryClick}
          onSettingsClick={handleLibrarySettingsClick}
          onLibraryAction={handleLibraryAction}
          onFolderAction={handleFolderAction}
        />
      )}
      <NewLibraryModal
        open={showLibraryModal}
        onClose={() => setShowLibraryModal(false)}
        projectId={projectId}
        folderId={null}
        onCreated={handleLibraryCreated}
      />
      {editingLibraryId && (
        <EditLibraryModal
          open={showEditLibraryModal}
          libraryId={editingLibraryId}
          onClose={() => {
            setShowEditLibraryModal(false);
            setEditingLibraryId(null);
          }}
          onUpdated={() => {
            // No need to manually invalidate - the hook already does this
            // Event is also dispatched automatically by useUpdateEntityName hook
          }}
        />
      )}
      <NewFolderModal
        open={showFolderModal}
        onClose={() => setShowFolderModal(false)}
        projectId={projectId}
        onCreated={handleFolderCreated}
      />
      {editingFolderId && (
        <EditFolderModal
          open={showEditFolderModal}
          folderId={editingFolderId}
          onClose={() => {
            setShowEditFolderModal(false);
            setEditingFolderId(null);
          }}
          onUpdated={() => {
            // No need to manually invalidate - the hook already does this
            // Event is also dispatched automatically by useUpdateEntityName hook
          }}
        />
      )}
    </div>
  );
}

