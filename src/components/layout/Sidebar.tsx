'use client';

import loginProductIcon from "@/assets/images/loginProductIcon.svg";
import addProjectIcon from "@/assets/images/addProjectIcon.svg";
import searchIcon from "@/assets/images/searchIcon.svg";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { EventDataNode } from "antd/es/tree";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigation } from "@/lib/contexts/NavigationContext";
import { useSupabase } from "@/lib/SupabaseContext";
import { queryKeys } from "@/lib/utils/queryKeys";
import { NewProjectModal } from "@/components/projects/NewProjectModal";
import { EditProjectModal } from "@/components/projects/EditProjectModal";
import { NewLibraryModal } from "@/components/libraries/NewLibraryModal";
import { EditLibraryModal } from "@/components/libraries/EditLibraryModal";
import { NewFolderModal } from "@/components/folders/NewFolderModal";
import { EditFolderModal } from "@/components/folders/EditFolderModal";
import { EditAssetModal } from "@/components/asset/EditAssetModal";
import { AddLibraryMenu } from "@/components/libraries/AddLibraryMenu";
import { Project, deleteProject } from "@/lib/services/projectService";
import { Library, deleteLibrary } from "@/lib/services/libraryService";
import { Folder, deleteFolder } from "@/lib/services/folderService";
import { useSidebarProjects } from "./useSidebarProjects";
import { useSidebarFoldersLibraries } from "./useSidebarFoldersLibraries";
import { useSidebarModals } from "./useSidebarModals";
import { useSidebarContextMenu } from "./useSidebarContextMenu";
import { SidebarTreeView } from "./SidebarTreeView";
import { SidebarProjectsList } from "./SidebarProjectsList";
import { SidebarLibrariesSection } from "./SidebarLibrariesSection";
import { deleteAsset } from "@/lib/services/libraryAssetsService";
import { SupabaseClient } from "@supabase/supabase-js";
import { ContextMenu, ContextMenuAction } from "./ContextMenu";
import type { UserProfileDisplay } from "@/lib/types/user";
import { useSidebarTree } from "./useSidebarTree";
import { useSidebarAssets } from "./useSidebarAssets";
import { useSidebarProjectRole } from "./useSidebarProjectRole";
import { useSidebarWindowEvents } from "./useSidebarWindowEvents";
import { useSidebarRealtime } from "./useSidebarRealtime";
import styles from "./Sidebar.module.css";

type SidebarProps = {
  userProfile?: UserProfileDisplay | null;
  onAuthRequest?: () => void;
};

export function Sidebar({ userProfile, onAuthRequest }: SidebarProps) {
  const router = useRouter();
  const pathname = usePathname(); // Only for pathname === '/projects' (auto-navigate)
  const {
    currentProjectId,
    currentLibraryId,
    currentFolderId,
    currentAssetId,
    isPredefinePage,
    isLibraryPage,
  } = useNavigation();
  const currentIds = useMemo(
    () => ({
      projectId: currentProjectId,
      libraryId: currentLibraryId,
      folderId: currentFolderId,
      assetId: currentAssetId,
      isPredefinePage,
      isLibraryPage,
    }),
    [currentProjectId, currentLibraryId, currentFolderId, currentAssetId, isPredefinePage, isLibraryPage]
  );
  const supabase = useSupabase();
  const queryClient = useQueryClient();
  
  const { userRole, isProjectOwner, refetchUserRole } = useSidebarProjectRole(currentIds.projectId, userProfile);
  const { assets, fetchAssets } = useSidebarAssets(currentIds.libraryId);

  const modals = useSidebarModals();
  const {
    showProjectModal,
    showEditProjectModal,
    editingProjectId,
    showLibraryModal,
    showEditLibraryModal,
    editingLibraryId,
    showFolderModal,
    showEditFolderModal,
    editingFolderId,
    showEditAssetModal,
    editingAssetId,
    openNewProject,
    closeProjectModal,
    openEditProject,
    closeEditProjectModal,
    openNewLibrary,
    closeLibraryModal,
    openEditLibrary,
    closeEditLibraryModal,
    openNewFolder,
    closeFolderModal,
    openEditFolder,
    closeEditFolderModal,
    openEditAsset,
    closeEditAssetModal,
  } = modals;

  const [showAddMenu, setShowAddMenu] = useState(false);
  const [addButtonRef, setAddButtonRef] = useState<HTMLButtonElement | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedKeys, setExpandedKeys] = useState<React.Key[]>([]);
  const [isSidebarVisible, setIsSidebarVisible] = useState(true);

  const { contextMenu, openContextMenu, closeContextMenu } = useSidebarContextMenu();

  const {
    projects,
    isLoading: loadingProjects,
    error: projectsError,
    refetch: refetchProjects,
  } = useSidebarProjects(userProfile?.id);

  const {
    folders,
    libraries,
    isLoading: loadingFoldersAndLibraries,
  } = useSidebarFoldersLibraries(currentIds.projectId);

  const loadingFolders = loadingFoldersAndLibraries;
  const loadingLibraries = loadingFoldersAndLibraries;

  // Handle errors
  useEffect(() => {
    if (projectsError) {
      setError((projectsError as any)?.message || "Failed to load projects");
    }
  }, [projectsError]);

  useSidebarWindowEvents(queryClient, currentIds.projectId, () =>
    setIsSidebarVisible((prev) => !prev)
  );

  useSidebarRealtime({
    supabase,
    queryClient,
    userProfile,
    currentProjectId: currentIds.projectId,
    router,
    refetchUserRole,
  });

  // Auto-navigate to first project on login if user has projects
  useEffect(() => {
    // Only auto-navigate if:
    // 1. User is on /projects page (pathname === '/projects')
    // 2. Projects list is loaded and not empty
    // 3. User is not a guest (userProfile exists)
    if (pathname === '/projects' && projects.length > 0 && !loadingProjects && userProfile) {
      const firstProject = projects[0];
      if (firstProject?.id) {
        router.push(`/${firstProject.id}`);
      }
    }
  }, [pathname, projects, loadingProjects, userProfile, router]);

  // Track current project ID to detect project switching
  const prevProjectIdRef = useRef<string | null>(null);
  // Track whether expanded state has been initialized (to avoid re-expanding after user manually collapses)
  const hasInitializedExpandedKeys = useRef(false);

  // React Query will automatically refetch data when currentIds.projectId changes
  // No need to manually call fetchFoldersAndLibraries
  useEffect(() => {
    // Reset expanded state and initialization flag when switching projects
    if (prevProjectIdRef.current !== currentIds.projectId) {
      setExpandedKeys([]);
      hasInitializedExpandedKeys.current = false;
      prevProjectIdRef.current = currentIds.projectId;
    }
  }, [currentIds.projectId]);

  // Smart cache refresh: If user is viewing a project that's not in the sidebar,
  // it might mean they were just added as a collaborator. Refresh the projects list.
  useEffect(() => {
    if (currentIds.projectId && projects.length > 0 && !loadingProjects) {
      const currentProjectExists = projects.some(p => p.id === currentIds.projectId);
      if (!currentProjectExists) {
        
        // Clear globalRequestCache and refetch
        (async () => {
          try {
            const { globalRequestCache } = await import('@/lib/hooks/useRequestCache');
            const { data: { user } } = await supabase.auth.getUser();
            if (user) {
              // Clear projects list cache
              const projectsCacheKey = `projects:list:${user.id}`;
              globalRequestCache.invalidate(projectsCacheKey);
              
              // Clear all caches for this project (important!)
              // This ensures fresh data and permissions
              const cacheKeys = [
                `auth:project-access:${currentIds.projectId}:${user.id}`,
                `auth:project-ownership:${currentIds.projectId}:${user.id}`,
                `auth:project-role:${currentIds.projectId}:${user.id}`,
                `project:${currentIds.projectId}`,
              ];
              cacheKeys.forEach(key => {
                globalRequestCache.invalidate(key);
              });
            }
            // Refetch projects list
            await refetchProjects();
          } catch (error) {
            console.error('[Sidebar] Error refreshing projects:', error);
          }
        })();
      }
    }
  }, [currentIds.projectId, projects, loadingProjects, refetchProjects, supabase]);

  // Sync selectedFolderId from URL (via NavigationContext)
  useEffect(() => {
    if (currentIds.folderId) {
      setSelectedFolderId(currentIds.folderId);
    } else {
      setSelectedFolderId(null);
    }
  }, [currentIds.folderId]);

  // Initialize expanded state: expand all folders by default when folder data is loaded
  // Only set default expansion on first load (when not initialized)
  useEffect(() => {
    if (folders.length > 0 && !hasInitializedExpandedKeys.current) {
      setExpandedKeys(folders.map((f) => `folder-${f.id}`));
      hasInitializedExpandedKeys.current = true;
    }
  }, [folders]);

  // actions
  const handleProjectClick = async (projectId: string) => {
    // Clear all related caches before navigation to ensure fresh data
    // This is important for collaborators who might have stale cache
    try {
      const { globalRequestCache } = await import('@/lib/hooks/useRequestCache');
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const cacheKeys = [
          // Authorization caches
          `auth:project-access:${projectId}:${user.id}`,
          `auth:project-ownership:${projectId}:${user.id}`,
          `auth:project-role:${projectId}:${user.id}`,
          // Project data cache
          `project:${projectId}`,
        ];
        cacheKeys.forEach(key => {
          globalRequestCache.invalidate(key);
        });
      }
    } catch (error) {
      console.error('[Sidebar] Error clearing caches:', error);
    }
    router.push(`/${projectId}`);
  };

  const handleLibraryClick = async (projectId: string, libraryId: string) => {
    // Clear authorization caches before navigation
    try {
      const { globalRequestCache } = await import('@/lib/hooks/useRequestCache');
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const authCacheKeys = [
          `auth:project-access:${projectId}:${user.id}`,
          `auth:library-access:${libraryId}:${user.id}`,
        ];
        authCacheKeys.forEach(key => {
          globalRequestCache.invalidate(key);
        });
      }
    } catch (error) {
      console.error('[Sidebar] Error clearing auth caches:', error);
    }
    router.push(`/${projectId}/${libraryId}`);
    fetchAssets(libraryId);
  };

  const handleLibraryPredefineClick = useCallback((projectId: string, libraryId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    router.push(`/${projectId}/${libraryId}/predefine`);
  }, [router]);

  const handleAssetClick = async (projectId: string, libraryId: string, assetId: string) => {
    // Clear authorization caches before navigation
    try {
      const { globalRequestCache } = await import('@/lib/hooks/useRequestCache');
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const authCacheKeys = [
          `auth:project-access:${projectId}:${user.id}`,
          `auth:library-access:${libraryId}:${user.id}`,
          `auth:asset-access:${assetId}:${user.id}`,
        ];
        authCacheKeys.forEach(key => {
          globalRequestCache.invalidate(key);
        });
      }
    } catch (error) {
      console.error('[Sidebar] Error clearing auth caches:', error);
    }
    router.push(`/${projectId}/${libraryId}/${assetId}`);
  };

  const handleAssetDelete = useCallback(async (
    assetId: string,
    libraryId: string,
    e: React.MouseEvent
  ) => {
    e.stopPropagation();
    if (!window.confirm('Delete this asset?')) return;
    try {
          
      await deleteAsset(supabase, assetId);
      
      // Clear cache before fetching to ensure fresh data
      const { globalRequestCache } = await import('@/lib/hooks/useRequestCache');
      const cacheKey = `assets:list:${libraryId}`;
      globalRequestCache.invalidate(cacheKey);
      
      // Invalidate React Query cache to ensure LibraryPage gets fresh data
      await queryClient.invalidateQueries({ queryKey: queryKeys.libraryAssets(libraryId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.librarySummary(libraryId) });
      
      // Refetch to ensure data is updated immediately
      await queryClient.refetchQueries({ queryKey: queryKeys.libraryAssets(libraryId) });
      await queryClient.refetchQueries({ queryKey: queryKeys.librarySummary(libraryId) });
      
      // Notify that asset was deleted
      window.dispatchEvent(new CustomEvent('assetDeleted', { detail: { libraryId } }));
      await fetchAssets(libraryId);
      
      // If currently viewing this asset, navigate to library page
      if (currentIds.assetId === assetId && currentIds.projectId) {
        router.push(`/${currentIds.projectId}/${libraryId}`);
      }
    } catch (err) {
      console.error('Failed to delete asset', err);
      alert(err instanceof Error ? err.message : 'Failed to delete asset');
    }
  }, [supabase, fetchAssets, currentIds.projectId, currentIds.assetId, queryClient, router]);

  const handleLibraryDelete = useCallback(async (libraryId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm('Delete this library?')) return;
    try {
      // Get library info before deleting to know which folder it belongs to
      const libraryToDelete = libraries.find(lib => lib.id === libraryId);
      const deletedFolderId = libraryToDelete?.folder_id || null;
      
      await deleteLibrary(supabase, libraryId);
      // Use React Query to refresh cache
      if (currentIds.projectId) {
        queryClient.invalidateQueries({ queryKey: ['folders-libraries', currentIds.projectId] });
      }
      
      // Dispatch event to notify ProjectPage and FolderPage to refresh
      window.dispatchEvent(new CustomEvent('libraryDeleted', {
        detail: { folderId: deletedFolderId, libraryId, projectId: currentIds.projectId }
      }));
      
      // If the deleted library is currently being viewed (including library page, predefine page, new asset page, or any asset in it), navigate to project page
      if (currentIds.libraryId === libraryId && currentIds.projectId) {
        router.push(`/${currentIds.projectId}`);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to delete library');
    }
  }, [supabase, currentIds.projectId, currentIds.libraryId, libraries, queryClient, router]);

  const handleFolderDelete = useCallback(async (folderId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm('Delete this folder? All libraries and subfolders under it will be removed.')) return;
    try {
      // Check if any libraries under this folder are being viewed
      const librariesInFolder = libraries.filter(lib => lib.folder_id === folderId);
      const isViewingLibraryInFolder = librariesInFolder.some(lib => lib.id === currentIds.libraryId);
      
      await deleteFolder(supabase, folderId);
      // Use React Query to refresh cache
      if (currentIds.projectId) {
        queryClient.invalidateQueries({ queryKey: ['folders-libraries', currentIds.projectId] });
      }
      
      // If currently viewing the folder page or a library in this folder, navigate to project page
      if (currentIds.folderId === folderId || isViewingLibraryInFolder) {
        if (currentIds.projectId) {
          router.push(`/${currentIds.projectId}`);
        }
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to delete folder');
    }
  }, [supabase, currentIds.projectId, currentIds.folderId, currentIds.libraryId, libraries, queryClient, router]);

  const onSelect = async (_keys: React.Key[], info: any) => {
    const key: string = info.node.key;
    if (key.startsWith('folder-')) {
      const id = key.replace('folder-', '');
      // Navigate to folder page
      if (currentIds.projectId) {
        // Clear authorization caches before navigation
        try {
          const { globalRequestCache } = await import('@/lib/hooks/useRequestCache');
          const { data: { user } } = await supabase.auth.getUser();
          if (user) {
            const authCacheKeys = [
              `auth:project-access:${currentIds.projectId}:${user.id}`,
              `auth:folder-access:${id}:${user.id}`,
            ];
            authCacheKeys.forEach(key => {
              globalRequestCache.invalidate(key);
            });
          }
        } catch (error) {
          console.error('[Sidebar] Error clearing auth caches:', error);
        }
        router.push(`/${currentIds.projectId}/folder/${id}`);
      }
    } else if (key.startsWith('library-')) {
      const id = key.replace('library-', '');
      setSelectedFolderId(null); // Clear folder selection when library is selected
      const projId = libraries.find((l) => l.id === id)?.project_id || currentIds.projectId || '';
      await handleLibraryClick(projId, id);
    } else if (key.startsWith('asset-')) {
      const assetId = key.replace('asset-', '');
      setSelectedFolderId(null); // Clear folder selection when asset is selected
      let libId: string | null = null;
      let projId: string | null = null;
      Object.entries(assets).some(([lId, arr]) => {
        const found = arr.find((a) => a.id === assetId);
        if (found) {
          libId = lId;
          const lib = libraries.find((l) => l.id === lId);
          projId = lib?.project_id || null;
          return true;
        }
        return false;
      });
      if (libId && projId) {
        await handleAssetClick(projId, libId, assetId);
      }
    }
  };

  const onExpand = async (keys: React.Key[], info: { node: EventDataNode }) => {
    // Update expanded state (sync update first to ensure UI responds immediately)
    setExpandedKeys(keys);
    
    const key = info.node.key as string;
    if (key.startsWith('library-')) {
      const id = key.replace('library-', '');
      if (!assets[id]) {
        await fetchAssets(id);
      }
    }
    // Folders don't need to fetch anything on expand/collapse
  };

  // Context menu handlers
  const handleContextMenu = (e: React.MouseEvent, type: 'project' | 'library' | 'folder' | 'asset', id: string) => {
    e.preventDefault();
    e.stopPropagation();
    openContextMenu(e.clientX, e.clientY, type, id);
  };

  const { treeData, selectedKeys } = useSidebarTree(
    currentIds,
    folders,
    libraries,
    {
      router,
      userRole,
      onContextMenu: handleContextMenu,
      openNewLibrary,
      setSelectedFolderId,
      setError,
      onLibraryPredefineClick: handleLibraryPredefineClick,
    }
  );

  const handleContextMenuAction = (action: ContextMenuAction) => {
    if (!contextMenu) return;
    
    // Handle collaborators action for projects
    if (action === 'collaborators' && contextMenu.type === 'project') {
      closeContextMenu();
      router.push(`/${contextMenu.id}/collaborators`);
      return;
    }
    
    // Handle rename action (Project info / Library info / Folder rename)
    if (action === 'rename') {
      if (contextMenu.type === 'project') {
        openEditProject(contextMenu.id);
        closeContextMenu();
        return;
      } else if (contextMenu.type === 'library') {
        openEditLibrary(contextMenu.id);
        closeContextMenu();
        return;
      } else if (contextMenu.type === 'folder') {
        openEditFolder(contextMenu.id);
        closeContextMenu();
        return;
      } else if (contextMenu.type === 'asset') {
        openEditAsset(contextMenu.id);
        closeContextMenu();
        return;
      }
    }
    
    // Handle delete action
    if (action === 'delete') {
      if (contextMenu.type === 'project') {
        if (window.confirm('Delete this project? All libraries under it will be removed.')) {
          // Call API route to delete project (requires service role)
          handleProjectDeleteViaAPI(contextMenu.id);
        }
      } else if (contextMenu.type === 'library') {
        if (window.confirm('Delete this library?')) {
          const libraryToDelete = libraries.find(lib => lib.id === contextMenu.id);
          const deletedFolderId = libraryToDelete?.folder_id || null;
          deleteLibrary(supabase, contextMenu.id).then(() => {
            // Use React Query to refresh cache
            if (currentIds.projectId) {
              queryClient.invalidateQueries({ queryKey: ['folders-libraries', currentIds.projectId] });
            }
            window.dispatchEvent(new CustomEvent('libraryDeleted', {
              detail: { folderId: deletedFolderId, libraryId: contextMenu.id, projectId: currentIds.projectId }
            }));
            // If the deleted library is currently being viewed, navigate to project page
            if (currentIds.libraryId === contextMenu.id && currentIds.projectId) {
              router.push(`/${currentIds.projectId}`);
            }
          }).catch((err: any) => {
            setError(err?.message || 'Failed to delete library');
          });
        }
      } else if (contextMenu.type === 'folder') {
        if (window.confirm('Delete this folder? All libraries and subfolders under it will be removed.')) {
          // Check if any libraries under this folder are being viewed
          const librariesInFolder = libraries.filter(lib => lib.folder_id === contextMenu.id);
          const isViewingLibraryInFolder = librariesInFolder.some(lib => lib.id === currentIds.libraryId);
          
          deleteFolder(supabase, contextMenu.id).then(() => {
            // Use React Query to refresh cache
            if (currentIds.projectId) {
              queryClient.invalidateQueries({ queryKey: ['folders-libraries', currentIds.projectId] });
            }
            window.dispatchEvent(new CustomEvent('folderDeleted', {
              detail: { folderId: contextMenu.id, projectId: currentIds.projectId }
            }));
            // If currently viewing the folder page or a library in this folder, navigate to project page
            if ((currentIds.folderId === contextMenu.id || isViewingLibraryInFolder) && currentIds.projectId) {
              router.push(`/${currentIds.projectId}`);
            }
          }).catch((err: any) => {
            setError(err?.message || 'Failed to delete folder');
          });
        }
      } else if (contextMenu.type === 'asset') {
        if (window.confirm('Delete this asset?')) {
          const libraryId = Object.keys(assets).find(libId => 
            assets[libId].some(asset => asset.id === contextMenu.id)
          );
          if (libraryId) {
            supabase
              .from('library_assets')
              .delete()
              .eq('id', contextMenu.id)
              .then(async (result) => {
                if (result.error) {
                  console.error('Failed to delete asset', result.error);
                } else {
                  // Clear cache before fetching to ensure fresh data
                  const { globalRequestCache } = await import('@/lib/hooks/useRequestCache');
                  const cacheKey = `assets:list:${libraryId}`;
                  globalRequestCache.invalidate(cacheKey);
                  
                  // Invalidate React Query cache to ensure LibraryPage gets fresh data
                  await queryClient.invalidateQueries({ queryKey: queryKeys.libraryAssets(libraryId) });
                  await queryClient.invalidateQueries({ queryKey: queryKeys.librarySummary(libraryId) });
                  
                  // Refetch to ensure data is updated immediately
                  await queryClient.refetchQueries({ queryKey: queryKeys.libraryAssets(libraryId) });
                  await queryClient.refetchQueries({ queryKey: queryKeys.librarySummary(libraryId) });
                  
                  await fetchAssets(libraryId);
                  window.dispatchEvent(new CustomEvent('assetDeleted', { detail: { libraryId } }));
                  // If currently viewing this asset, navigate to library page
                  if (currentIds.assetId === contextMenu.id && currentIds.projectId) {
                    router.push(`/${currentIds.projectId}/${libraryId}`);
                  }
                }
              });
          }
        }
      }
    }
    
    closeContextMenu();
  };

  const handleProjectDelete = async (projectId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm('Delete this project? All libraries under it will be removed.')) return;
    handleProjectDeleteViaAPI(projectId);
  };

  const handleProjectDeleteViaAPI = async (projectId: string) => {
    try {
      // Get user session for API call
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setError('You must be logged in to delete projects');
        return;
      }

      // Call API route to delete project
      const response = await fetch(`/api/projects/${projectId}/delete`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
        },
      });

      const result = await response.json();

      if (!result.success) {
        setError(result.error || 'Failed to delete project');
        return;
      }

      // Success - immediately update the cache to remove the deleted project
      // This prevents the auto-navigation logic from redirecting back to a project
      queryClient.setQueryData<Project[]>(['projects'], (oldProjects) => {
        if (!oldProjects) return [];
        return oldProjects.filter(p => p.id !== projectId);
      });
      
      // Clear globalRequestCache
      const { globalRequestCache } = await import('@/lib/hooks/useRequestCache');
      const { getCurrentUserId } = await import('@/lib/services/authorizationService');
      try {
        const userId = await getCurrentUserId(supabase);
        globalRequestCache.invalidate(`projects:list:${userId}`);
        globalRequestCache.invalidate(`project:${projectId}`);
      } catch (err) {
        console.warn('Failed to clear cache:', err);
      }

      // Navigate away if viewing deleted project
      if (currentIds.projectId === projectId) {
        router.push('/projects');
      }
      
      // Invalidate queries to trigger a background refetch (but UI already updated via setQueryData)
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    } catch (err: any) {
      console.error('[Sidebar] Error deleting project:', err);
      setError(err?.message || 'Failed to delete project');
    }
  };
  const handleProjectCreated = async (projectId: string, defaultFolderId: string) => {
    closeProjectModal();
    
    // Immediately invalidate React Query cache to refresh the sidebar
    queryClient.invalidateQueries({ queryKey: ['projects'] });
    
    // Also invalidate globalRequestCache for projects list
    const { globalRequestCache } = await import('@/lib/hooks/useRequestCache');
    const { getCurrentUserId } = await import('@/lib/services/authorizationService');
    try {
      const userId = await getCurrentUserId(supabase);
      globalRequestCache.invalidate(`projects:list:${userId}`);
    } catch (err) {
      // If getting userId fails, invalidate all project-related cache
      console.warn('Failed to get userId for cache invalidation, clearing all project cache', err);
    }
    
    // Dispatch event to notify other components (ProjectsPage) to refresh their caches
    window.dispatchEvent(new CustomEvent('projectCreated'));
    
    // Always navigate to the newly created project
    if (projectId) {
      router.push(`/${projectId}`);
      // React Query will automatically fetch folders and libraries when currentIds.projectId changes
      // No need to manually call fetchFoldersAndLibraries
    }
  };

  const handleLibraryCreated = async (libraryId: string) => {
    closeLibraryModal();
    const createdFolderId = selectedFolderId;
    setSelectedFolderId(null); // Clear selection after creation
    
    // Only dispatch event, let all listeners refresh cache uniformly to avoid duplicate requests
    // All components (Sidebar, ProjectPage, FolderPage) will listen to this event and refresh their respective caches
    window.dispatchEvent(new CustomEvent('libraryCreated', {
      detail: { folderId: createdFolderId, libraryId, projectId: currentIds.projectId }
    }));
    
    // Always navigate to the newly created library if we have a projectId
    if (currentIds.projectId) {
      router.push(`/${currentIds.projectId}/${libraryId}`);
    }
  };

  const handleFolderCreated = async (folderId: string) => {
    closeFolderModal();
    setSelectedFolderId(null); // Clear selection after creation
    
    // Only dispatch event, let all listeners refresh cache uniformly to avoid duplicate requests
    // All components (Sidebar, ProjectPage) will listen to this event and refresh their respective caches
    window.dispatchEvent(new CustomEvent('folderCreated', {
      detail: { projectId: currentIds.projectId, folderId }
    }));
    
    // Always navigate to the newly created folder if we have a projectId
    if (currentIds.projectId && folderId) {
      router.push(`/${currentIds.projectId}/folder/${folderId}`);
    }
  };

  const handleAddButtonClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (!currentIds.projectId) {
      // If no project is selected, show error or do nothing
      return;
    }
    setAddButtonRef(e.currentTarget);
    setShowAddMenu(true);
  };

  const handleCreateFolder = () => {
    setShowAddMenu(false);
    if (!currentIds.projectId) {
      setError('Please select a project first');
      return;
    }
    // selectedFolderId is already set when button is clicked
    openNewFolder();
  };

  const handleCreateLibrary = () => {
    setShowAddMenu(false);
    if (!currentIds.projectId) {
      setError('Please select a project first');
      return;
    }
    // selectedFolderId is already set when button is clicked
    openNewLibrary();
  };

  const handleLogoClick = () => {
    // Navigate to first project if available, otherwise go to projects list
    if (projects.length > 0) {
      const firstProject = projects[0];
      router.push(`/${firstProject.id}`);
    } else {
      router.push('/projects');
    }
  };

  return (
    <aside className={`${styles.sidebar} ${!isSidebarVisible ? styles.sidebarHidden : ''}`}>
      <div className={styles.header}>
        <div 
          className={styles.headerLogo}
          onClick={handleLogoClick}
          style={{ cursor: 'pointer' }}
        >
          <Image src={loginProductIcon} alt="Keco Studio" width={32} height={32} />
          <div className={styles.headerBrand}>
            <div className={styles.brandName}>Keco Studio</div>
            <div className={styles.brandSlogan}>for game designers</div>
        </div>
        </div>
      </div>

      <div className={styles.searchContainer}>
        <label className={styles.searchLabel}>
          <Image
            src={searchIcon}
            alt="Search"
            width={24}
            height={24}
            className={styles.searchIcon}
          />
          <input
            placeholder="Search for..."
            className={styles.searchInput}
          />
        </label>
      </div>

      <div className={styles.content}>
        {!currentIds.assetId && (
          <SidebarProjectsList
            projects={projects}
            loadingProjects={loadingProjects}
            currentProjectId={currentIds.projectId}
            onOpenNewProject={openNewProject}
            onProjectClick={handleProjectClick}
            onContextMenu={handleContextMenu}
          />
        )}

        {currentIds.projectId &&
          projects.length > 0 &&
          projects.some((p) => p.id === currentIds.projectId) && (
            <SidebarLibrariesSection
              currentIds={currentIds}
              libraries={libraries}
              assets={assets}
              userRole={userRole}
              loadingFolders={loadingFolders}
              loadingLibraries={loadingLibraries}
              foldersLength={folders.length}
              librariesLength={libraries.length}
              treeData={treeData}
              selectedKeys={selectedKeys}
              expandedKeys={expandedKeys}
              onSelect={onSelect}
              onExpand={onExpand}
              onBackToLibrary={() => {
                if (currentIds.projectId && currentIds.libraryId) {
                  router.push(`/${currentIds.projectId}/${currentIds.libraryId}`);
                }
              }}
              onLibraryPredefineClick={handleLibraryPredefineClick}
              onAddNewAsset={() => {
                if (currentIds.projectId && currentIds.libraryId) {
                  router.push(`/${currentIds.projectId}/${currentIds.libraryId}/new`);
                }
              }}
              onAssetClick={handleAssetClick}
              onContextMenu={handleContextMenu}
              addButtonRef={setAddButtonRef}
              onAddButtonClick={handleAddButtonClick}
            />
          )}
      </div>

      <NewProjectModal
        open={showProjectModal}
        onClose={closeProjectModal}
        onCreated={handleProjectCreated}
      />

      {editingProjectId && (
        <EditProjectModal
          open={showEditProjectModal}
          projectId={editingProjectId}
          onClose={closeEditProjectModal}
          onUpdated={() => {
            // Cache will be invalidated by the projectUpdated event listener
          }}
        />
      )}

      <NewLibraryModal
        open={showLibraryModal}
        onClose={closeLibraryModal}
        projectId={currentIds.projectId || ''}
        folderId={selectedFolderId}
        onCreated={handleLibraryCreated}
      />

      {editingLibraryId && (
        <EditLibraryModal
          open={showEditLibraryModal}
          libraryId={editingLibraryId}
          onClose={closeEditLibraryModal}
          onUpdated={() => {
            // Cache will be invalidated by the libraryUpdated event listener
          }}
        />
      )}

      <NewFolderModal
        open={showFolderModal}
        onClose={closeFolderModal}
        projectId={currentIds.projectId || ''}
        onCreated={handleFolderCreated}
      />

      {editingFolderId && (
        <EditFolderModal
          open={showEditFolderModal}
          folderId={editingFolderId}
          onClose={closeEditFolderModal}
          onUpdated={() => {
            // Cache will be invalidated by the folderUpdated event listener
          }}
        />
      )}

      {editingAssetId && (
        <EditAssetModal
          open={showEditAssetModal}
          assetId={editingAssetId}
          onClose={closeEditAssetModal}
          onUpdated={() => {
            // Cache will be invalidated by the assetUpdated event listener
          }}
        />
      )}

      <AddLibraryMenu
        open={showAddMenu}
        anchorElement={addButtonRef}
        onClose={() => setShowAddMenu(false)}
        onCreateFolder={handleCreateFolder}
        onCreateLibrary={handleCreateLibrary}
      />
      
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          type={contextMenu.type}
          onClose={closeContextMenu}
          onAction={handleContextMenuAction}
          userRole={userRole}
          isProjectOwner={isProjectOwner}
        />
      )}
    </aside>
  );
}

