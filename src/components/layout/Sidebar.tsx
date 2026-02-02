'use client';

import projectIcon from "@/assets/images/projectIcon.svg";
import libraryBookIcon from "@/assets/images/LibraryBookIcon.svg";
import loginProductIcon from "@/assets/images/loginProductIcon.svg";
import predefineSettingIcon from "@/assets/images/predefineSettingIcon.svg";
import FolderOpenIcon from "@/assets/images/FolderOpenIcon.svg";
import FolderCloseIcon from "@/assets/images/FolderCloseIcon.svg";
import folderExpandIcon from "@/assets/images/folderExpandIcon.svg";
import folderCollapseIcon from "@/assets/images/folderCollapseIcon.svg";
import plusHorizontal from "@/assets/images/plusHorizontal.svg";
import plusVertical from "@/assets/images/plusVertical.svg";
import createProjectIcon from "@/assets/images/createProjectIcon.svg";
import addProjectIcon from "@/assets/images/addProjectIcon.svg";
import searchIcon from "@/assets/images/searchIcon.svg";
import projectRightIcon from "@/assets/images/ProjectRightIcon.svg";
import sidebarFolderIcon from "@/assets/images/SidebarFloderIcon.svg";
import sidebarFolderIcon3 from "@/assets/images/SidebarFloderIcon3.svg";
import sidebarFolderIcon4 from "@/assets/images/SidebarFloderIcon4.svg";
import sidebarFolderIcon5 from "@/assets/images/SidebarFolderInco5.svg";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Tree, Tooltip } from "antd";
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
import { deleteAsset } from "@/lib/services/libraryAssetsService";
import { SupabaseClient } from "@supabase/supabase-js";
import { ContextMenu, ContextMenuAction } from "./ContextMenu";
import type { UserProfileDisplay } from "@/lib/types/user";
import { truncateText } from "@/lib/utils/truncateText";
import { useSidebarTree } from "./useSidebarTree";
import styles from "./Sidebar.module.css";

type SidebarProps = {
  userProfile?: UserProfileDisplay | null;
  onAuthRequest?: () => void;
};

type AssetRow = { id: string; name: string; library_id: string };

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
  
  // Resolve display name: prefer username, then full_name, then email
  const displayName = userProfile?.username || userProfile?.full_name || userProfile?.email || "Guest";
  const isGuest = !userProfile;
  
  // User role in current project
  const [userRole, setUserRole] = useState<'admin' | 'editor' | 'viewer' | null>(null);
  const [isProjectOwner, setIsProjectOwner] = useState(false);
  
  // Resolve avatar: use avatar_url if valid, otherwise fallback to initial
  const hasValidAvatar = userProfile?.avatar_url && userProfile.avatar_url.trim() !== "";
  const avatarInitial = displayName.charAt(0).toUpperCase();
  const [avatarError, setAvatarError] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close user menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowMenu(false);
      }
    };

    if (showMenu) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showMenu]);

  const handleLogout = async () => {
    setShowMenu(false);
    try {
      await supabase.auth.signOut();
      // Call parent callback to keep auth state in sync
      if (onAuthRequest) {
        onAuthRequest();
      }
      // Navigate to /projects after logout
      router.push('/projects');
    } catch (error) {
      console.error('Logout failed', error);
      // Even if sign-out fails, still notify parent to keep state consistent
      if (onAuthRequest) {
        onAuthRequest();
      }
      // Navigate to /projects even if logout fails
      router.push('/projects');
    }
  };

  const handleAuthNav = async () => {
    setShowMenu(false);
    if (onAuthRequest) {
      onAuthRequest();
      return;
    }
    // fallback: sign out and let caller react to auth state change
    await supabase.auth.signOut();
  };

  // data state - managed by React Query, no need for manual state
  const [assets, setAssets] = useState<Record<string, AssetRow[]>>({});

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
  
  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    type: 'project' | 'library' | 'folder' | 'asset';
    id: string;
  } | null>(null);

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

  // Listen to projectCreated event to refresh Sidebar data when project is created from other pages
  // Use React Query's invalidateQueries to refresh cache, React Query will automatically refetch data
  useEffect(() => {
    const handleProjectCreated = () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    };

    const handleProjectUpdated = (event: CustomEvent) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      // Also invalidate the specific project cache if projectId is provided
      if (event.detail?.projectId) {
        queryClient.invalidateQueries({ queryKey: ['project', event.detail.projectId] });
      }
    };

    window.addEventListener('projectCreated' as any, handleProjectCreated as EventListener);
    window.addEventListener('projectUpdated' as any, handleProjectUpdated as EventListener);
    
    return () => {
      window.removeEventListener('projectCreated' as any, handleProjectCreated as EventListener);
      window.removeEventListener('projectUpdated' as any, handleProjectUpdated as EventListener);
    };
  }, [queryClient]);

  // Listen to authStateChanged event to clear React Query cache when user signs out or switches
  useEffect(() => {
    const handleAuthStateChanged = () => {
      // Clear all React Query cache when auth state changes (sign out or user switch)
      queryClient.clear();
    };

    window.addEventListener('authStateChanged' as any, handleAuthStateChanged as EventListener);
    
    return () => {
      window.removeEventListener('authStateChanged' as any, handleAuthStateChanged as EventListener);
    };
  }, [queryClient]);

  // Real-time collaboration: Subscribe to projects table changes
  useEffect(() => {
    if (!userProfile) {
      return;
    }
    
    // Subscribe to projects table for real-time updates
    // We listen to ALL projects (no filter) so collaborators can also receive updates
    const projectsChannel = supabase
      .channel(`projects:user:${userProfile.id}`)
      .on(
        'postgres_changes',
        {
          event: '*', // Listen to all events (INSERT, UPDATE, DELETE)
          schema: 'public',
          table: 'projects',
          // No filter - listen to all projects, then check on client side
        },
        async (payload) => {
          // Get the project ID from the event
          const projectId = (payload.new && 'id' in payload.new ? payload.new.id : null) || 
                           (payload.old && 'id' in payload.old ? payload.old.id : null);
          
          // Check if this project is in the user's project list
          const currentProjects = queryClient.getQueryData<Project[]>(['projects']) || [];
          const isUserProject = currentProjects.some(p => p.id === projectId);
          
          // Only process events for projects the user has access to
          if (!isUserProject && payload.eventType !== 'INSERT') {
            return;
          }
          
          // Invalidate globalRequestCache
          const { globalRequestCache } = await import('@/lib/hooks/useRequestCache');
          const { getCurrentUserId } = await import('@/lib/services/authorizationService');
          
          try {
            const userId = await getCurrentUserId(supabase);
            globalRequestCache.invalidate(`projects:list:${userId}`);
            
            // Also invalidate specific project cache
            if (projectId) {
              globalRequestCache.invalidate(`project:${projectId}`);
              globalRequestCache.invalidate(`project:name:${projectId}`);
            }
          } catch (err) {
            console.warn('[Sidebar] Error invalidating project cache:', err);
          }
          
          // Invalidate React Query cache
          await queryClient.invalidateQueries({ queryKey: ['projects'] });
          await queryClient.refetchQueries({ 
            queryKey: ['projects'],
            type: 'active',
          });
          
          // Dispatch events for other components
          if (payload.eventType === 'UPDATE' && payload.new && 'id' in payload.new) {
            window.dispatchEvent(new CustomEvent('projectUpdated', {
              detail: { projectId: payload.new.id }
            }));
          } else if (payload.eventType === 'DELETE' && payload.old && 'id' in payload.old) {
            // Immediately update the cache to remove the deleted project
            queryClient.setQueryData<Project[]>(['projects'], (oldProjects) => {
              if (!oldProjects) return [];
              return oldProjects.filter(p => p.id !== payload.old.id);
            });
            
            window.dispatchEvent(new CustomEvent('projectDeleted', {
              detail: { projectId: payload.old.id }
            }));
            
            // If the deleted project is currently being viewed, navigate away
            if (currentIds.projectId === payload.old.id) {
              router.push('/projects');
            }
          }
        }
      )
      .subscribe((status, err) => {
        if (status === 'CHANNEL_ERROR') {
          if (err) {
            console.error('[Sidebar] Projects channel ERROR:', err);
          } else {
            console.warn('[Sidebar] Projects channel error (Realtime may be disabled or connection limited).');
          }
        } else if (status === 'TIMED_OUT') {
          console.error('[Sidebar] Projects channel TIMED OUT');
        }
      });

    return () => {
      supabase.removeChannel(projectsChannel);
    };
  }, [userProfile, supabase, queryClient, currentIds.projectId, router]);

  // Real-time collaboration: Subscribe to libraries table changes
  useEffect(() => {
    if (!currentIds.projectId || !userProfile) {
      return;
    }
    
    // Subscribe to libraries table for real-time updates
    const librariesChannel = supabase
      .channel(`libraries:project:${currentIds.projectId}`)
      .on(
        'postgres_changes',
        {
          event: '*', // Listen to all events (INSERT, UPDATE, DELETE)
          schema: 'public',
          table: 'libraries',
          filter: `project_id=eq.${currentIds.projectId}`,
        },
        async (payload) => {
          console.log('[Sidebar] 🔥 LIBRARIES CHANGE DETECTED:', {
            eventType: payload.eventType,
            table: payload.table,
            schema: payload.schema,
            new: payload.new,
            old: payload.old,
            commit_timestamp: payload.commit_timestamp,
          });
          
          // CRITICAL: Must invalidate globalRequestCache first!
          // Otherwise listLibraries() will return cached data even when React Query refetches
          const { globalRequestCache } = await import('@/lib/hooks/useRequestCache');
          globalRequestCache.invalidate(`libraries:list:${currentIds.projectId}:all`);
          
          // Also invalidate individual library cache for NavigationContext
          if (payload.new && 'id' in payload.new) {
            globalRequestCache.invalidate(`library:info:${payload.new.id}`);
            globalRequestCache.invalidate(`library:${payload.new.id}`);
          }
          console.log('[Sidebar] ✅ globalRequestCache invalidated for libraries');
          
          // Step 1: Invalidate React Query cache to mark data as stale
          await queryClient.invalidateQueries({ queryKey: ['folders-libraries', currentIds.projectId] });
          console.log('[Sidebar] ✅ React Query cache invalidated');
          
          // Step 2: Force refetch to get fresh data from database
          await queryClient.refetchQueries({ 
            queryKey: ['folders-libraries', currentIds.projectId],
            type: 'active', // Only refetch active queries
          });
          console.log('[Sidebar] ✅ Force refetch completed for folders-libraries');
          
          // Step 3: Dispatch events for other components to react
          if (payload.eventType === 'UPDATE' && payload.new && 'id' in payload.new) {
            window.dispatchEvent(new CustomEvent('libraryUpdated', {
              detail: { libraryId: payload.new.id, projectId: currentIds.projectId }
            }));
            console.log('[Sidebar] ✅ libraryUpdated event dispatched');
          } else if (payload.eventType === 'DELETE' && payload.old && 'id' in payload.old) {
            window.dispatchEvent(new CustomEvent('libraryDeleted', {
              detail: { libraryId: payload.old.id, projectId: currentIds.projectId }
            }));
            console.log('[Sidebar] ✅ libraryDeleted event dispatched');
          } else if (payload.eventType === 'INSERT' && payload.new && 'id' in payload.new) {
            window.dispatchEvent(new CustomEvent('libraryCreated', {
              detail: { libraryId: payload.new.id, projectId: currentIds.projectId }
            }));
            console.log('[Sidebar] ✅ libraryCreated event dispatched');
          }
        }
      )
      .subscribe((status, err) => {
        if (status === 'CHANNEL_ERROR') {
          if (err) {
            console.error('[Sidebar] Libraries channel ERROR:', err);
          } else {
            console.warn('[Sidebar] Libraries channel error (Realtime may be disabled or connection limited).');
          }
        } else if (status === 'TIMED_OUT') {
          console.error('[Sidebar] Libraries channel TIMED OUT');
        }
      });

    return () => {
      supabase.removeChannel(librariesChannel);
    };
  }, [currentIds.projectId, userProfile, supabase, queryClient]);

  // Real-time collaboration: Subscribe to folders table changes
  useEffect(() => {
    if (!currentIds.projectId || !userProfile) {
      return;
    }
    
    // Subscribe to folders table for real-time updates
    const foldersChannel = supabase
      .channel(`folders:project:${currentIds.projectId}`)
      .on(
        'postgres_changes',
        {
          event: '*', // Listen to all events (INSERT, UPDATE, DELETE)
          schema: 'public',
          table: 'folders',
          filter: `project_id=eq.${currentIds.projectId}`,
        },
        async (payload) => {
          console.log('[Sidebar] 🔥 FOLDERS CHANGE DETECTED:', {
            eventType: payload.eventType,
            table: payload.table,
            schema: payload.schema,
            new: payload.new,
            old: payload.old,
            commit_timestamp: payload.commit_timestamp,
          });
          
          // CRITICAL: Must invalidate globalRequestCache first!
          // Otherwise listFolders() will return cached data even when React Query refetches
          const { globalRequestCache } = await import('@/lib/hooks/useRequestCache');
          globalRequestCache.invalidate(`folders:list:${currentIds.projectId}`);
          
          // Also invalidate individual folder cache
          if (payload.new && 'id' in payload.new) {
            globalRequestCache.invalidate(`folder:${payload.new.id}`);
          }
          console.log('[Sidebar] ✅ globalRequestCache invalidated for folders');
          
          // Step 1: Invalidate React Query cache to mark data as stale
          await queryClient.invalidateQueries({ queryKey: ['folders-libraries', currentIds.projectId] });
          console.log('[Sidebar] ✅ React Query cache invalidated');
          
          // Step 2: Force refetch to get fresh data from database
          await queryClient.refetchQueries({ 
            queryKey: ['folders-libraries', currentIds.projectId],
            type: 'active', // Only refetch active queries
          });
          console.log('[Sidebar] ✅ Force refetch completed for folders-libraries');
          
          // Step 3: Dispatch events for other components to react
          if (payload.eventType === 'UPDATE' && payload.new && 'id' in payload.new) {
            window.dispatchEvent(new CustomEvent('folderUpdated', {
              detail: { folderId: payload.new.id, projectId: currentIds.projectId }
            }));
            console.log('[Sidebar] ✅ folderUpdated event dispatched');
          } else if (payload.eventType === 'DELETE' && payload.old && 'id' in payload.old) {
            window.dispatchEvent(new CustomEvent('folderDeleted', {
              detail: { folderId: payload.old.id, projectId: currentIds.projectId }
            }));
            console.log('[Sidebar] ✅ folderDeleted event dispatched');
          } else if (payload.eventType === 'INSERT' && payload.new && 'id' in payload.new) {
            window.dispatchEvent(new CustomEvent('folderCreated', {
              detail: { folderId: payload.new.id, projectId: currentIds.projectId }
            }));
            console.log('[Sidebar] ✅ folderCreated event dispatched');
          }
        }
      )
      .subscribe((status, err) => {
        if (status === 'CHANNEL_ERROR') {
          if (err) {
            console.error('[Sidebar] Folders channel ERROR:', err);
          } else {
            console.warn('[Sidebar] Folders channel error (Realtime may be disabled or connection limited).');
          }
        } else if (status === 'TIMED_OUT') {
          console.error('[Sidebar] Folders channel TIMED OUT');
        }
      });

    return () => {
      supabase.removeChannel(foldersChannel);
    };
  }, [currentIds.projectId, userProfile, supabase, queryClient]);

  // Real-time collaboration: Subscribe to project_collaborators table changes (for permission updates)
  useEffect(() => {
    if (!currentIds.projectId || !userProfile) {
      return;
    }
    
    // Subscribe to project_collaborators table for real-time permission updates
    const collaboratorsChannel = supabase
      .channel(`collaborators:project:${currentIds.projectId}`)
      .on(
        'postgres_changes',
        {
          event: '*', // Listen to all events (INSERT, UPDATE, DELETE)
          schema: 'public',
          table: 'project_collaborators',
          filter: `project_id=eq.${currentIds.projectId}`,
        },
        async (payload) => {
          // Handle DELETE event - collaborator was removed or project was deleted
          // Note: We don't check user_id because REPLICA IDENTITY might not be FULL
          // Instead, we check if current user still has access to the project
          if (payload.eventType === 'DELETE') {
            // Check if current user still has access to this project
            const { data: accessCheck } = await supabase
              .from('project_collaborators')
              .select('id')
              .eq('project_id', currentIds.projectId)
              .eq('user_id', userProfile.id)
              .single();
            
            // Also check if project still exists
            const { data: projectCheck } = await supabase
              .from('projects')
              .select('id, owner_id')
              .eq('id', currentIds.projectId)
              .single();
            
            // Determine if user still has access
            const isOwner = projectCheck?.owner_id === userProfile.id;
            const hasCollaboratorAccess = !!accessCheck;
            const hasAccess = isOwner || hasCollaboratorAccess;
            
            if (!projectCheck) {
              // Project was deleted
              // Remove project from cache
              queryClient.setQueryData<Project[]>(['projects'], (oldProjects) => {
                if (!oldProjects) return [];
                return oldProjects.filter(p => p.id !== currentIds.projectId);
              });
              
              // Clear global cache
              const { globalRequestCache } = await import('@/lib/hooks/useRequestCache');
              const { getCurrentUserId } = await import('@/lib/services/authorizationService');
              try {
                const userId = await getCurrentUserId(supabase);
                globalRequestCache.invalidate(`projects:list:${userId}`);
                globalRequestCache.invalidate(`project:${currentIds.projectId}`);
              } catch (err) {
                console.warn('[Sidebar] Failed to clear cache:', err);
              }
              
              // Dispatch event
              window.dispatchEvent(new CustomEvent('projectDeleted', {
                detail: { projectId: currentIds.projectId }
              }));
              
              // Navigate away
              router.push('/projects');
            } else if (!hasAccess) {
              // User was removed from project (not owner and no collaborator access)
              // Remove project from cache
              queryClient.setQueryData<Project[]>(['projects'], (oldProjects) => {
                if (!oldProjects) return [];
                return oldProjects.filter(p => p.id !== currentIds.projectId);
              });
              
              // Clear global cache
              const { globalRequestCache } = await import('@/lib/hooks/useRequestCache');
              const { getCurrentUserId } = await import('@/lib/services/authorizationService');
              try {
                const userId = await getCurrentUserId(supabase);
                globalRequestCache.invalidate(`projects:list:${userId}`);
                globalRequestCache.invalidate(`project:${currentIds.projectId}`);
              } catch (err) {
                console.warn('[Sidebar] Failed to clear cache:', err);
              }
              
              // Invalidate and refetch
              queryClient.invalidateQueries({ queryKey: ['projects'] });
              
              // Navigate away
              router.push('/projects');
            }
          }
          
          // Handle INSERT/UPDATE events - check if the change affects current user
          if ((payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') && 
              payload.new && 'user_id' in payload.new && payload.new.user_id === userProfile.id) {
            // Current user's permission changed, refetch role
            try {
              const { data: { session } } = await supabase.auth.getSession();
              if (!session) return;
              
              const roleResponse = await fetch(`/api/projects/${currentIds.projectId}/role`, {
                headers: {
                  'Authorization': `Bearer ${session.access_token}`,
                },
              });
              
              if (roleResponse.ok) {
                const roleResult = await roleResponse.json();
                setUserRole(roleResult.role || null);
                setIsProjectOwner(roleResult.isOwner || false);
              }
            } catch (error) {
              console.error('[Sidebar] Error refetching user role:', error);
            }
          }
        }
      )
      .subscribe((status, err) => {
        if (status === 'CHANNEL_ERROR') {
          if (err) {
            console.error('[Sidebar] Collaborators channel ERROR:', err);
          } else {
            console.warn('[Sidebar] Collaborators channel error (Realtime may be disabled or connection limited).');
          }
        } else if (status === 'TIMED_OUT') {
          console.error('[Sidebar] Collaborators channel TIMED OUT');
        }
      });

    return () => {
      supabase.removeChannel(collaboratorsChannel);
    };
  }, [currentIds.projectId, userProfile, supabase, queryClient, router]);

  // Real-time collaboration: Subscribe to predefine_properties changes (for predefine updates)
  useEffect(() => {
    if (!currentIds.projectId || !userProfile) {
      return;
    }
    
    // Subscribe to predefine_properties for real-time predefine updates
    // When properties are added/updated/deleted, other collaborators should see the changes
    const predefineChannel = supabase
      .channel(`predefine:project:${currentIds.projectId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'predefine_properties',
        },
        async (payload) => {
          // Check if this property belongs to a library in current project
          // We'll refresh the libraries cache which will pick up property changes
          if (payload.new && 'library_id' in payload.new) {
            // CRITICAL: Must invalidate globalRequestCache first!
            const { globalRequestCache } = await import('@/lib/hooks/useRequestCache');
            globalRequestCache.invalidate(`libraries:list:${currentIds.projectId}:all`);
            
            // Invalidate and refetch to ensure UI updates
            await queryClient.invalidateQueries({ queryKey: ['folders-libraries', currentIds.projectId] });
            await queryClient.refetchQueries({ 
              queryKey: ['folders-libraries', currentIds.projectId],
              type: 'active',
            });
          } else if (payload.old && 'library_id' in payload.old) {
            // Handle DELETE events - CRITICAL: Must invalidate globalRequestCache first!
            const { globalRequestCache } = await import('@/lib/hooks/useRequestCache');
            globalRequestCache.invalidate(`libraries:list:${currentIds.projectId}:all`);
            
            await queryClient.invalidateQueries({ queryKey: ['folders-libraries', currentIds.projectId] });
            await queryClient.refetchQueries({ 
              queryKey: ['folders-libraries', currentIds.projectId],
              type: 'active',
            });
          }
        }
      )
      .subscribe((status, err) => {
        if (status === 'CHANNEL_ERROR') {
          if (err) {
            console.error('[Sidebar] Predefine channel ERROR:', err);
          } else {
            console.warn('[Sidebar] Predefine channel error (Realtime may be disabled or connection limited).');
          }
        } else if (status === 'TIMED_OUT') {
          console.error('[Sidebar] Predefine channel TIMED OUT');
        }
      });

    return () => {
      supabase.removeChannel(predefineChannel);
    };
  }, [currentIds.projectId, userProfile, supabase, queryClient]);

  // Listen to sidebar toggle event from TopBar
  useEffect(() => {
    const handleSidebarToggle = () => {
      setIsSidebarVisible(prev => !prev);
    };

    window.addEventListener('sidebar-toggle', handleSidebarToggle);
    
    return () => {
      window.removeEventListener('sidebar-toggle', handleSidebarToggle);
    };
  }, []);

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

  // Fetch user role in current project
  useEffect(() => {
    const fetchUserRole = async () => {
      // Check if projectId is a valid UUID (not "projects" or other route segments)
      const isValidUUID = currentIds.projectId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(currentIds.projectId);
      
      if (!isValidUUID || !userProfile) {
        setUserRole(null);
        setIsProjectOwner(false);
        return;
      }
      
      try {
        // Get session for authorization
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          setUserRole(null);
          setIsProjectOwner(false);
          return;
        }
        
        // Call API to get user role
        const roleResponse = await fetch(`/api/projects/${currentIds.projectId}/role`, {
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
          },
        });
        
        if (roleResponse.ok) {
          const roleResult = await roleResponse.json();
          setUserRole(roleResult.role || null);
          setIsProjectOwner(roleResult.isOwner || false);
        } else {
          setUserRole(null);
          setIsProjectOwner(false);
        }
      } catch (error) {
        console.error('[Sidebar] Error fetching user role:', error);
        setUserRole(null);
        setIsProjectOwner(false);
      }
    };
    
    fetchUserRole();
  }, [currentIds.projectId, userProfile, supabase]);

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

  // Listen to library/folder created/deleted events to refresh Sidebar data when changed from other pages
  // Use React Query's invalidateQueries to refresh cache
  // Add debounce mechanism to avoid frequent invalidateQueries causing duplicate requests
  const invalidateTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  useEffect(() => {
    const invalidateFoldersAndLibraries = (projectId: string | null) => {
      if (!projectId) return;
      
      // Clear previous timer to implement debounce
      if (invalidateTimeoutRef.current) {
        clearTimeout(invalidateTimeoutRef.current);
      }
      
      // Delay 100ms execution to avoid triggering multiple requests when quickly switching projects
      invalidateTimeoutRef.current = setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['folders-libraries', projectId] });
      }, 100);
    };

    const handleLibraryCreated = (event: CustomEvent) => {
      // Get projectId from event detail, refresh cache if current project matches
      const eventProjectId = event.detail?.projectId || currentIds.projectId;
      if (eventProjectId === currentIds.projectId) {
        invalidateFoldersAndLibraries(currentIds.projectId);
      }
    };

    const handleFolderCreated = (event: CustomEvent) => {
      // Get projectId from event detail, refresh cache if current project matches
      const eventProjectId = event.detail?.projectId || currentIds.projectId;
      if (eventProjectId === currentIds.projectId) {
        invalidateFoldersAndLibraries(currentIds.projectId);
      }
    };

    const handleLibraryDeleted = (event: CustomEvent) => {
      // Refresh cache for the project where the library was deleted
      const deletedProjectId = event.detail?.projectId;
      if (currentIds.projectId && deletedProjectId === currentIds.projectId) {
        invalidateFoldersAndLibraries(currentIds.projectId);
      }
    };

    const handleLibraryUpdated = (event: CustomEvent) => {
      // Refresh cache for the current project if we have one
      // The library update will invalidate its own cache, but we need to refresh the list
      if (currentIds.projectId) {
        invalidateFoldersAndLibraries(currentIds.projectId);
      }
    };

    const handleFolderDeleted = (event: CustomEvent) => {
      // Refresh cache for the project where the folder was deleted
      const deletedProjectId = event.detail?.projectId;
      if (currentIds.projectId && deletedProjectId === currentIds.projectId) {
        invalidateFoldersAndLibraries(currentIds.projectId);
      }
    };

    const handleFolderUpdated = (event: CustomEvent) => {
      // Refresh cache for the current project if we have one
      // The folder update will invalidate its own cache, but we need to refresh the list
      if (currentIds.projectId) {
        invalidateFoldersAndLibraries(currentIds.projectId);
      }
    };

    window.addEventListener('libraryCreated' as any, handleLibraryCreated as EventListener);
    window.addEventListener('folderCreated' as any, handleFolderCreated as EventListener);
    window.addEventListener('libraryDeleted' as any, handleLibraryDeleted as EventListener);
    window.addEventListener('libraryUpdated' as any, handleLibraryUpdated as EventListener);
    window.addEventListener('folderDeleted' as any, handleFolderDeleted as EventListener);
    window.addEventListener('folderUpdated' as any, handleFolderUpdated as EventListener);
    
    return () => {
      // Clear timer
      if (invalidateTimeoutRef.current) {
        clearTimeout(invalidateTimeoutRef.current);
      }
      window.removeEventListener('libraryCreated' as any, handleLibraryCreated as EventListener);
      window.removeEventListener('folderCreated' as any, handleFolderCreated as EventListener);
      window.removeEventListener('libraryDeleted' as any, handleLibraryDeleted as EventListener);
      window.removeEventListener('libraryUpdated' as any, handleLibraryUpdated as EventListener);
      window.removeEventListener('folderDeleted' as any, handleFolderDeleted as EventListener);
      window.removeEventListener('folderUpdated' as any, handleFolderUpdated as EventListener);
    };
  }, [currentIds.projectId, queryClient]);

  const fetchingAssetsRef = useRef<Set<string>>(new Set());

  const fetchAssets = useCallback(async (libraryId?: string | null) => {
    if (!libraryId) return;
    
    // Prevent duplicate concurrent requests for the same library
    if (fetchingAssetsRef.current.has(libraryId)) {
      return;
    }
    
    fetchingAssetsRef.current.add(libraryId);
    try {
      // Use cache to prevent duplicate requests
      const { globalRequestCache } = await import('@/lib/hooks/useRequestCache');
      const cacheKey = `assets:list:${libraryId}`;
      
      const data = await globalRequestCache.fetch(cacheKey, async () => {
        const { data, error } = await supabase
          .from('library_assets')
          .select('id,name,library_id')
          .eq('library_id', libraryId)
          .order('created_at', { ascending: true });
        if (error) throw error;
        return (data as AssetRow[]) || [];
      });
      
      setAssets((prev) => ({ ...prev, [libraryId]: data }));
    } catch (err) {
      console.error('Failed to load assets', err);
    } finally {
      fetchingAssetsRef.current.delete(libraryId);
    }
  }, [supabase]);

  useEffect(() => {
    if (currentIds.libraryId) {
      fetchAssets(currentIds.libraryId);
    }
  }, [currentIds.libraryId, fetchAssets]);

  // Listen for asset creation/update events to refresh the sidebar
  useEffect(() => {
    const handleAssetChange = async (event: Event) => {
      const customEvent = event as CustomEvent<{ libraryId: string }>;
      if (customEvent.detail?.libraryId) {
        // Clear cache before fetching to ensure fresh data
        const { globalRequestCache } = await import('@/lib/hooks/useRequestCache');
        const cacheKey = `assets:list:${customEvent.detail.libraryId}`;
        globalRequestCache.invalidate(cacheKey);
        fetchAssets(customEvent.detail.libraryId);
      }
    };

    window.addEventListener('assetCreated', handleAssetChange);
    window.addEventListener('assetUpdated', handleAssetChange);
    window.addEventListener('assetDeleted', handleAssetChange);

    return () => {
      window.removeEventListener('assetCreated', handleAssetChange);
      window.removeEventListener('assetUpdated', handleAssetChange);
      window.removeEventListener('assetDeleted', handleAssetChange);
    };
  }, [fetchAssets]);


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

  const switcherIcon = (node: any) => {
    const { expanded, isLeaf, data } = node || {};
    const key = (data?.key ?? node?.key) as string | undefined;

    if (isLeaf || !key) return null;

    if (key.startsWith('folder-')) {
      if (!expanded) {
        return (
          <Image
            src={FolderCloseIcon}
            alt="Closed folder"
            width={24}
            height={24}
            style={{ display: 'block' }}
          />
        );
      }
      // Expanded: use two icons + CSS so treenode:hover (whole row incl. switcher) shows expand icon
      return (
        <div className={styles.folderSwitcherIcons}>
          <Image
            src={FolderOpenIcon}
            alt="Open folder"
            width={24}
            height={24}
            className={styles.folderSwitcherBase}
          />
          <Image
            src={folderExpandIcon}
            alt="Expand"
            width={14}
            height={8}
            className={styles.folderSwitcherHover}
          />
        </div>
      );
    }

    // All libraries are leaf nodes (no expand) — no switcher
    if (key.startsWith('library-')) return null;

    return null; // no switcher for other node types
  };

  // Context menu handlers
  const handleContextMenu = (e: React.MouseEvent, type: 'project' | 'library' | 'folder' | 'asset', id: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      type,
      id,
    });
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
      setContextMenu(null);
      router.push(`/${contextMenu.id}/collaborators`);
      return;
    }
    
    // Handle rename action (Project info / Library info / Folder rename)
    if (action === 'rename') {
      if (contextMenu.type === 'project') {
        openEditProject(contextMenu.id);
        setContextMenu(null);
        return;
      } else if (contextMenu.type === 'library') {
        openEditLibrary(contextMenu.id);
        setContextMenu(null);
        return;
      } else if (contextMenu.type === 'folder') {
        openEditFolder(contextMenu.id);
        setContextMenu(null);
        return;
      } else if (contextMenu.type === 'asset') {
        openEditAsset(contextMenu.id);
        setContextMenu(null);
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
    
    setContextMenu(null);
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
          <>
            <div className={styles.sectionTitle}>
              <span>Projects</span>
              <button
                className={styles.addButton}
                onClick={() => openNewProject()}
                title="New Project"
              >
                <Image
                  src={addProjectIcon}
                  alt="Add project"
                  width={24}
                  height={24}
                />
              </button>
            </div>
            <div className={styles.projectsListContainer}>
              {projects.map((project) => {
                const isActive = currentIds.projectId === project.id;
                return (
                  <div
                    key={project.id}
                    className={`${styles.item} ${isActive ? styles.itemActive : styles.itemInactive}`}
                    onClick={() => handleProjectClick(project.id)}
                    onContextMenu={(e) => handleContextMenu(e, 'project', project.id)}
                  >
                    <Image
                      src={projectIcon}
                      alt="Project"
                      width={20}
                      height={20}
                      className={styles.itemIcon}
                    />
                    <span className={styles.itemText} title={project.name}>
                      {truncateText(project.name, 20)}
                    </span>
                    <span className={styles.itemActions}>
                      {project.description && (
                        <Tooltip
                          title={project.description}
                          placement="top"
                          styles={{
                            root: { maxWidth: '300px' }
                          }}
                        >
                          <div
                            className={styles.infoIconWrapper}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Image
                              src={projectRightIcon}
                              alt="Info"
                              width={24}
                              height={24}
                            />
                          </div>
                        </Tooltip>
                      )}
                    </span>
                  </div>
                );
              })}
              {!loadingProjects && projects.length === 0 && (
                <button
                  className={styles.createProjectButton}
                  onClick={() => openNewProject()}
                >
                  <Image
                    src={createProjectIcon}
                    alt="Project"
                    width={24}
                    height={24}
                    className={styles.itemIcon}
                  />
                  <span className={styles.itemText}>Create Project</span>
                </button>
              )}
            </div>
          </>
        )}

        {currentIds.projectId &&
          projects.length > 0 &&
          projects.some((p) => p.id === currentIds.projectId) && (
            <>
              {!currentIds.assetId && (
                <div className={styles.sectionTitle}>
                  <span>Libraries</span>
                  {userRole === 'admin' && (
                    <button
                      ref={setAddButtonRef}
                      className={styles.addButton}
                      onClick={handleAddButtonClick}
                      title="Add new folder or library"
                    >
                      <Image
                        src={addProjectIcon}
                        alt="Add library"
                        width={24}
                        height={24}
                      />
                    </button>
                  )}
                </div>
              )}
              <div className={styles.sectionList}>
                {currentIds.assetId && currentIds.libraryId ? (
                  // Asset page only: Show library with assets list
                  (() => {
                    const currentLibrary = libraries.find(lib => lib.id === currentIds.libraryId);
                    const libraryName = currentLibrary?.name || 'Library';
                    const libraryAssets = assets[currentIds.libraryId] || [];
                    return (
                      <>
                        {/* Library item */}
                        <div className={`${styles.itemRow} ${styles.libraryItemActiveWithPadding}`}>
                          <div className={styles.itemMain}>
                            <button
                              className={styles.libraryBackButton}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (currentIds.projectId && currentIds.libraryId) {
                                  router.push(`/${currentIds.projectId}/${currentIds.libraryId}`);
                                }
                              }}
                              title="Back to library"
                            >
                              <Image
                                src={sidebarFolderIcon3}
                                alt="Back"
                                width={24}
                                height={24}
                              />
                            </button>
                            <div className={styles.libraryIconContainer}>
                              <Image
                                src={libraryBookIcon}
                                alt="Library"
                                width={24}
                                height={24}
                              />
                            </div>
                            <span className={styles.itemText} title={libraryName}>{truncateText(libraryName, 15)}</span>
                          </div>
                          <div className={styles.itemActions}>
                            {userRole === 'admin' && (
                              <Tooltip
                                title="Predefine asset here"
                                placement="top"
                                color="#8B5CF6"
                              >
                                <button
                                  className={styles.iconButton}
                                  aria-label="Library sections"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (currentIds.projectId && currentIds.libraryId) {
                                      handleLibraryPredefineClick(currentIds.projectId, currentIds.libraryId, e);
                                    }
                                  }}
                                >
                                  <Image
                                    src={sidebarFolderIcon4}
                                    alt="Predefine"
                                    width={22}
                                    height={22}
                                  />
                                </button>
                              </Tooltip>
                            )}
                          </div>
                        </div>
                        {/* Add new asset button - for admin and editor */}
                        {(userRole === 'admin' || userRole === 'editor') && (
                          <button
                            className={`${styles.createButton} ${styles.createButtonAligned}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (currentIds.projectId && currentIds.libraryId) {
                                // Navigate to new asset page
                                // If library has no properties, the page will show predefine prompt (NoassetIcon1.svg)
                                // If library has properties, the page will show the form to create new asset
                                router.push(`/${currentIds.projectId}/${currentIds.libraryId}/new`);
                              }
                            }}
                          >
                            <span className={styles.createButtonText}>
                              <Image
                                src={sidebarFolderIcon5}
                                alt="Add"
                                width={24}
                                height={24}
                              />
                              Add new asset
                            </span>
                          </button>
                        )}
                        {/* Assets list */}
                        <div className={styles.assetList}>
                          {libraryAssets.map((asset) => {
                            const isCurrentAsset = currentIds.assetId === asset.id;

                            return (
                              <div
                                key={asset.id}
                                className={`${styles.itemRow} ${isCurrentAsset ? styles.assetItemActive : ''}`}
                                onClick={() => {
                                  // All users can navigate to asset detail (viewer will see it in view mode)
                                  if (currentIds.projectId && currentIds.libraryId) {
                                    handleAssetClick(currentIds.projectId, currentIds.libraryId, asset.id);
                                  }
                                }}
                                onContextMenu={(e) => handleContextMenu(e, 'asset', asset.id)}
                              >
                                <div className={styles.itemMain}>
                                  <span className={styles.itemText} title={asset.name && asset.name !== 'Untitled' ? asset.name : ''}>
                                    {truncateText(asset.name && asset.name !== 'Untitled' ? asset.name : '', 15)}
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </>
                    );
                  })()
                ) : (
                  // Normal view: Show tree structure
                  <>
                    <div className={styles.treeWrapper}>
                      <Tree
                        className={styles.tree}
                        showIcon={false}
                        treeData={treeData}
                        selectedKeys={selectedKeys}
                        onSelect={onSelect}
                        onExpand={onExpand}
                        switcherIcon={switcherIcon}
                        expandedKeys={expandedKeys}
                        motion={false}
                      />
                    </div>
                    {!loadingFolders &&
                      !loadingLibraries &&
                      folders.length === 0 &&
                      libraries.length === 0 && (
                        <div className={styles.sidebarEmptyState}>
                          <Image
                            src={FolderCloseIcon}
                            alt="No folders or libraries"
                            width={22}
                            height={18}
                            className={styles.emptyIcon}
                          />
                          <div className={styles.sidebarEmptyText}>
                            No folder or library in this project yet.
                          </div>
                        </div>
                      )}
                  </>
                )}
              </div>
            </>
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
          onClose={() => setContextMenu(null)}
          onAction={handleContextMenuAction}
          userRole={userRole}
          isProjectOwner={isProjectOwner}
        />
      )}
    </aside>
  );
}

