'use client';

import projectIcon from "@/app/assets/images/projectIcon.svg";
import libraryBookIcon from "@/app/assets/images/LibraryBookIcon.svg";
import loginProductIcon from "@/app/assets/images/loginProductIcon.svg";
import predefineSettingIcon from "@/app/assets/images/predefineSettingIcon.svg";
import folderExpandIcon from "@/app/assets/images/folderExpandIcon.svg";
import folderCollapseIcon from "@/app/assets/images/folderCollapseIcon.svg";
import folderIcon from "@/app/assets/images/folderIcon.svg";
import plusHorizontal from "@/app/assets/images/plusHorizontal.svg";
import plusVertical from "@/app/assets/images/plusVertical.svg";
import createProjectIcon from "@/app/assets/images/createProjectIcon.svg";
import addProjectIcon from "@/app/assets/images/addProjectIcon.svg";
import searchIcon from "@/app/assets/images/searchIcon.svg";
import projectRightIcon from "@/app/assets/images/ProjectRightIcon.svg";
import sidebarFolderIcon from "@/app/assets/images/SidebarFloderIcon.svg";
import sidebarFolderIcon3 from "@/app/assets/images/SidebarFloderIcon3.svg";
import sidebarFolderIcon4 from "@/app/assets/images/SidebarFloderIcon4.svg";
import sidebarFolderIcon5 from "@/app/assets/images/SidebarFolderInco5.svg";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Tree, Tooltip } from "antd";
import { DataNode, EventDataNode } from "antd/es/tree";
import { useSupabase } from "@/lib/SupabaseContext";
import { NewProjectModal } from "@/components/projects/NewProjectModal";
import { NewLibraryModal } from "@/components/libraries/NewLibraryModal";
import { NewFolderModal } from "@/components/folders/NewFolderModal";
import { AddLibraryMenu } from "@/components/libraries/AddLibraryMenu";
import { listProjects, Project, deleteProject } from "@/lib/services/projectService";
import { listLibraries, Library, deleteLibrary } from "@/lib/services/libraryService";
import { listFolders, Folder, deleteFolder } from "@/lib/services/folderService";
import { deleteAsset } from "@/lib/services/libraryAssetsService";
import { SupabaseClient } from "@supabase/supabase-js";
import { ContextMenu, ContextMenuAction } from "./ContextMenu";
import styles from "./Sidebar.module.css";

type UserProfile = {
  id: string;
  email: string;
  username: string | null;
  full_name: string | null;
  avatar_url: string | null;
};

type SidebarProps = {
  userProfile?: UserProfile | null;
  onAuthRequest?: () => void;
};

type AssetRow = { id: string; name: string; library_id: string };

// Helper function to truncate text with ellipsis
const truncateText = (text: string, maxLength: number): string => {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '...';
};

export function Sidebar({ userProfile, onAuthRequest }: SidebarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const supabase = useSupabase();
  // Resolve display name: prefer username, then full_name, then email
  const displayName = userProfile?.username || userProfile?.full_name || userProfile?.email || "Guest";
  const isGuest = !userProfile;
  
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
    } catch (error) {
      console.error('Logout failed', error);
      // Even if sign-out fails, still notify parent to keep state consistent
      if (onAuthRequest) {
        onAuthRequest();
      }
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

  // data state
  const [projects, setProjects] = useState<Project[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [assets, setAssets] = useState<Record<string, AssetRow[]>>({});

  const [loadingProjects, setLoadingProjects] = useState(false);
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [loadingLibraries, setLoadingLibraries] = useState(false);
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [showLibraryModal, setShowLibraryModal] = useState(false);
  const [showFolderModal, setShowFolderModal] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [addButtonRef, setAddButtonRef] = useState<HTMLButtonElement | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedKeys, setExpandedKeys] = useState<React.Key[]>([]);
  // Loading states for after creation
  const [loadingAfterCreate, setLoadingAfterCreate] = useState(false);
  const [createMessage, setCreateMessage] = useState<string>('');
  
  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    type: 'project' | 'library' | 'folder' | 'asset';
    id: string;
  } | null>(null);

  const currentIds = useMemo(() => {
    const parts = pathname.split("/").filter(Boolean);
    // Handle /[projectId]/[libraryId] or /[projectId]/folder/[folderId] or /[projectId]/[libraryId]/predefine structure
    const projectId = parts[0] || null;
    let libraryId: string | null = null;
    let folderId: string | null = null;
    let isPredefinePage = false;
    let assetId: string | null = null;
    let isLibraryPage = false; // True when on /[projectId]/[libraryId] (not predefine, not asset)
    
    if (parts.length >= 2 && parts[1] === 'folder' && parts[2]) {
      // URL format: /[projectId]/folder/[folderId]
      folderId = parts[2];
    } else if (parts.length >= 3 && parts[2] === 'predefine') {
      // URL format: /[projectId]/[libraryId]/predefine
      libraryId = parts[1];
      isPredefinePage = true;
    } else if (parts.length >= 3) {
      // URL format: /[projectId]/[libraryId]/[assetId] or /[projectId]/[libraryId]/new
      libraryId = parts[1];
      assetId = parts[2];
    } else if (parts.length >= 2) {
      // URL format: /[projectId]/[libraryId] - library page
      libraryId = parts[1];
      isLibraryPage = true;
    }
    
    return { projectId, libraryId, folderId, isPredefinePage, assetId, isLibraryPage };
  }, [pathname]);

  const fetchProjects = useCallback(async () => {
    setLoadingProjects(true);
    setError(null);
    try {
      const data = await listProjects(supabase);
      setProjects(data);
    } catch (e: any) {
      setError(e?.message || "Failed to load projects");
    } finally {
      setLoadingProjects(false);
    }
  }, [supabase]);

  const fetchFoldersAndLibraries = useCallback(async (projectId?: string | null) => {
    if (!projectId) {
      setFolders([]);
      setLibraries([]);
      setAssets({});
      return;
    }
    setLoadingFolders(true);
    setLoadingLibraries(true);
    setError(null);
    try {
      const [foldersData, librariesData] = await Promise.all([
        listFolders(supabase, projectId),
        listLibraries(supabase, projectId),
      ]);
      setFolders(foldersData);
      setLibraries(librariesData);
    } catch (e: any) {
      setError(e?.message || "Failed to load folders and libraries");
    } finally {
      setLoadingFolders(false);
      setLoadingLibraries(false);
    }
  }, [supabase]);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  // Listen to projectCreated event to refresh Sidebar data when project is created from other pages
  useEffect(() => {
    const handleProjectCreated = () => {
      fetchProjects();
    };

    window.addEventListener('projectCreated' as any, handleProjectCreated as EventListener);
    
    return () => {
      window.removeEventListener('projectCreated' as any, handleProjectCreated as EventListener);
    };
  }, [fetchProjects]);

  // Track current project ID to detect project switching
  const prevProjectIdRef = useRef<string | null>(null);
  // Track whether expanded state has been initialized (to avoid re-expanding after user manually collapses)
  const hasInitializedExpandedKeys = useRef(false);

  useEffect(() => {
    fetchFoldersAndLibraries(currentIds.projectId);
    // Reset expanded state and initialization flag when switching projects
    if (prevProjectIdRef.current !== currentIds.projectId) {
      setExpandedKeys([]);
      hasInitializedExpandedKeys.current = false;
      prevProjectIdRef.current = currentIds.projectId;
    }
  }, [currentIds.projectId, fetchFoldersAndLibraries]);

  // Sync selectedFolderId from URL
  useEffect(() => {
    if (currentIds.folderId) {
      setSelectedFolderId(currentIds.folderId);
    } else {
      // Only clear if we're not on a folder page
      const parts = pathname.split("/").filter(Boolean);
      if (parts.length < 3 || parts[1] !== 'folder') {
        setSelectedFolderId(null);
      }
    }
  }, [currentIds.folderId, pathname]);

  // Initialize expanded state: expand all folders by default when folder data is loaded
  // Only set default expansion on first load (when not initialized)
  useEffect(() => {
    if (folders.length > 0 && !hasInitializedExpandedKeys.current) {
      setExpandedKeys(folders.map((f) => `folder-${f.id}`));
      hasInitializedExpandedKeys.current = true;
    }
  }, [folders]);

  // Listen to library/folder created/deleted events to refresh Sidebar data when changed from other pages
  useEffect(() => {
    const handleLibraryCreated = (event: CustomEvent) => {
      // Refresh folders and libraries data for current project
      if (currentIds.projectId) {
        fetchFoldersAndLibraries(currentIds.projectId);
      }
    };

    const handleFolderCreated = () => {
      // Refresh folders and libraries data for current project
      if (currentIds.projectId) {
        fetchFoldersAndLibraries(currentIds.projectId);
      }
    };

    const handleLibraryDeleted = (event: CustomEvent) => {
      // Refresh folders and libraries data for current project
      const deletedProjectId = event.detail?.projectId;
      if (currentIds.projectId && deletedProjectId === currentIds.projectId) {
        fetchFoldersAndLibraries(currentIds.projectId);
      }
    };

    const handleFolderDeleted = (event: CustomEvent) => {
      // Refresh folders and libraries data for current project
      const deletedProjectId = event.detail?.projectId;
      if (currentIds.projectId && deletedProjectId === currentIds.projectId) {
        fetchFoldersAndLibraries(currentIds.projectId);
      }
    };

    window.addEventListener('libraryCreated' as any, handleLibraryCreated as EventListener);
    window.addEventListener('folderCreated' as any, handleFolderCreated as EventListener);
    window.addEventListener('libraryDeleted' as any, handleLibraryDeleted as EventListener);
    window.addEventListener('folderDeleted' as any, handleFolderDeleted as EventListener);
    
    return () => {
      window.removeEventListener('libraryCreated' as any, handleLibraryCreated as EventListener);
      window.removeEventListener('folderCreated' as any, handleFolderCreated as EventListener);
      window.removeEventListener('libraryDeleted' as any, handleLibraryDeleted as EventListener);
      window.removeEventListener('folderDeleted' as any, handleFolderDeleted as EventListener);
    };
  }, [currentIds.projectId, fetchFoldersAndLibraries]);

  const fetchAssets = useCallback(async (libraryId?: string | null) => {
    if (!libraryId) return;
    try {
      const { data, error } = await supabase
        .from('library_assets')
        .select('id,name,library_id')
        .eq('library_id', libraryId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      setAssets((prev) => ({ ...prev, [libraryId]: (data as AssetRow[]) || [] }));
    } catch (err) {
      console.error('Failed to load assets', err);
    }
  }, [supabase]);

  useEffect(() => {
    if (currentIds.libraryId) {
      fetchAssets(currentIds.libraryId);
    }
  }, [currentIds.libraryId, fetchAssets]);

  // Listen for asset creation/update events to refresh the sidebar
  useEffect(() => {
    const handleAssetChange = (event: Event) => {
      const customEvent = event as CustomEvent<{ libraryId: string }>;
      if (customEvent.detail?.libraryId) {
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
  const handleProjectClick = (projectId: string) => {
    router.push(`/${projectId}`);
  };

  const handleLibraryClick = (projectId: string, libraryId: string) => {
    router.push(`/${projectId}/${libraryId}`);
    fetchAssets(libraryId);
  };

  const handleLibraryPredefineClick = useCallback((projectId: string, libraryId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    router.push(`/${projectId}/${libraryId}/predefine`);
  }, [router]);

  const handleAssetClick = (projectId: string, libraryId: string, assetId: string) => {
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
      // Notify that asset was deleted
      window.dispatchEvent(new CustomEvent('assetDeleted', { detail: { libraryId } }));
      await fetchAssets(libraryId);
      
      // Check if currently viewing this asset, if so navigate to library page
      const parts = pathname.split("/").filter(Boolean);
      // URL format: /[projectId]/[libraryId]/[assetId]
      if (parts.length >= 3 && parts[2] === assetId && currentIds.projectId) {
        router.push(`/${currentIds.projectId}/${libraryId}`);
      }
    } catch (err) {
      console.error('Failed to delete asset', err);
      alert(err instanceof Error ? err.message : 'Failed to delete asset');
    }
  }, [supabase, fetchAssets, pathname, currentIds.projectId, router]);

  const handleLibraryDelete = useCallback(async (libraryId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm('Delete this library?')) return;
    try {
      // Get library info before deleting to know which folder it belongs to
      const libraryToDelete = libraries.find(lib => lib.id === libraryId);
      const deletedFolderId = libraryToDelete?.folder_id || null;
      
      await deleteLibrary(supabase, libraryId);
      fetchFoldersAndLibraries(currentIds.projectId);
      
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
  }, [supabase, currentIds.projectId, currentIds.libraryId, libraries, fetchFoldersAndLibraries, router]);

  const handleFolderDelete = useCallback(async (folderId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm('Delete this folder? All libraries and subfolders under it will be removed.')) return;
    try {
      // Check if any libraries under this folder are being viewed
      const librariesInFolder = libraries.filter(lib => lib.folder_id === folderId);
      const isViewingLibraryInFolder = librariesInFolder.some(lib => lib.id === currentIds.libraryId);
      
      await deleteFolder(supabase, folderId);
      fetchFoldersAndLibraries(currentIds.projectId);
      
      // If currently viewing the folder page or a library in this folder, navigate to project page
      if (currentIds.folderId === folderId || isViewingLibraryInFolder) {
        if (currentIds.projectId) {
          router.push(`/${currentIds.projectId}`);
        }
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to delete folder');
    }
  }, [supabase, currentIds.projectId, currentIds.folderId, currentIds.libraryId, libraries, fetchFoldersAndLibraries, router]);

  const treeData: DataNode[] = useMemo(() => {
    if (!currentIds.projectId) return [];
    
    // Filter folders and libraries for current project
    const projectFolders = folders.filter((f) => f.project_id === currentIds.projectId);
    const projectLibraries = libraries.filter((lib) => lib.project_id === currentIds.projectId);
    
    // Group libraries by folder_id
    // Use string keys for Map to ensure proper matching
    const librariesByFolder = new Map<string, Library[]>();
    projectLibraries.forEach((lib) => {
      // Convert null to empty string for root libraries, or use folder_id as string
      // Ensure folder_id is converted to string (handle null case)
      const folderId = lib.folder_id ? String(lib.folder_id) : '';
      if (!librariesByFolder.has(folderId)) {
        librariesByFolder.set(folderId, []);
      }
      librariesByFolder.get(folderId)!.push(lib);
    });
    
    // Debug: log libraries grouping
    if (process.env.NODE_ENV === 'development') {
      console.log('Libraries grouped by folder_id:', {
        totalLibraries: projectLibraries.length,
        librariesByFolderKeys: Array.from(librariesByFolder.keys()),
        librariesByFolder: Object.fromEntries(librariesByFolder),
        folders: projectFolders.map(f => ({ id: f.id, name: f.name }))
      });
    }
    
    // Build folder node (simplified: no nested folders, all folders are root level)
    const buildFolderNode = (folder: Folder): DataNode => {
      // Get libraries for this folder (folder.id is string, so it matches Map key)
      // Ensure folder.id is converted to string for Map lookup
      const folderLibraries = librariesByFolder.get(String(folder.id)) || [];
      
      // Debug: log folder node building
      if (process.env.NODE_ENV === 'development') {
        console.log(`Building folder node: ${folder.name} (id: ${folder.id})`, {
          folderLibraries: folderLibraries.length,
          folderLibrariesNames: folderLibraries.map(l => l.name)
        });
      }
      
      // Create button node for "Create new library" - always first child
      const createButtonNode: DataNode = {
        title: (
          <button
            className={styles.createButton}
            data-testid="sidebar-create-library-button"
            onClick={(e) => {
              e.stopPropagation();
              if (!currentIds.projectId) {
                setError('Please select a project first');
                return;
              }
              setSelectedFolderId(folder.id);
              setShowLibraryModal(true);
            }}
          >
            <span className={styles.createButtonText}>
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
              {' '}Create new library
            </span>
          </button>
        ),
        key: `folder-create-${folder.id}`,
        isLeaf: true,
      };
      
      const children: DataNode[] = [
        createButtonNode, // Always first
        ...folderLibraries.map((lib) => {
          const libProjectId = lib.project_id;
          // Show selected state when on library page OR when viewing an asset in this library
          const isCurrentLibrary = currentIds.libraryId === lib.id && (currentIds.isLibraryPage || !!currentIds.assetId);
          // Show icons only when viewing an asset (not on library page)
          const showAssetPageIcons = currentIds.libraryId === lib.id && !!currentIds.assetId;
          return {
            title: (
              <div 
                className={`${styles.itemRow} ${isCurrentLibrary ? (showAssetPageIcons ? styles.libraryItemActiveWithPadding : styles.libraryItemActive) : ''}`}
                onContextMenu={(e) => handleContextMenu(e, 'library', lib.id)}
              >
                <div className={styles.itemMain}>
                  {showAssetPageIcons && (
                    <button
                      className={styles.libraryBackButton}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (currentIds.projectId) {
                          router.push(`/${currentIds.projectId}`);
                        }
                      }}
                      title="Back to tree view"
                    >
                      <Image
                        src={sidebarFolderIcon3}
                        alt="Back"
                        width={24}
                        height={24}
                      />
                    </button>
                  )}
                  <div className={styles.libraryIconContainer}>
                    <Image
                      src={libraryBookIcon}
                      alt="Library"
                      width={24}
                      height={24}
                    />
                  </div>
                  <span className={styles.itemText}>{lib.name}</span>
                </div>
                <div className={styles.itemActions}>
                  <Tooltip
                    title="Predefine asset here"
                    placement="top"
                    color="#8B5CF6"
                  >
                    <button
                      className={styles.iconButton}
                      aria-label="Library sections"
                      onClick={(e) => handleLibraryPredefineClick(libProjectId, lib.id, e)}
                    >
                      <Image
                        src={showAssetPageIcons ? sidebarFolderIcon4 : predefineSettingIcon}
                        alt="Predefine"
                        width={22}
                        height={22}
                      />
                    </button>
                  </Tooltip>
                </div>
              </div>
            ),
            key: `library-${lib.id}`,
            isLeaf: false, // Allow expand to show assets and create button
            children: [
              // Create new asset button - always first
              {
                title: (
                  <button
                    className={styles.createButton}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!currentIds.projectId) {
                        setError('Please select a project first');
                        return;
                      }
                      router.push(`/${libProjectId}/${lib.id}/new`);
                    }}
                  >
                    <span className={styles.createButtonText}>
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
                      {' '}Add new asset
                    </span>
                  </button>
                ),
                key: `add-asset-${lib.id}`,
                isLeaf: true,
              },
              // Existing assets
              ...(assets[lib.id] || []).map<DataNode>((asset) => {
                const isCurrentAsset = currentIds.assetId === asset.id;
                return {
                  title: (
                    <div 
                      className={`${styles.itemRow} ${isCurrentAsset ? styles.assetItemActive : ''}`}
                      onContextMenu={(e) => handleContextMenu(e, 'asset', asset.id)}
                    >
                      <div className={styles.itemMain}>
                        <span className={styles.itemText}>{asset.name}</span>
                      </div>
                      <div className={styles.itemActions}>
                      </div>
                    </div>
                  ),
                  key: `asset-${asset.id}`,
                  isLeaf: true,
                };
              }),
            ],
          };
        }),
      ];
      
      return {
        title: (
          <div 
            className={styles.itemRow}
            onContextMenu={(e) => handleContextMenu(e, 'folder', folder.id)}
          >
            <div className={styles.itemMain}>
              <Image
                src={folderIcon}
                alt="Folder"
                width={24}
                height={18}
                className={styles.itemIcon}
              />
              <span className={styles.itemText} style={{ fontWeight: 500 }}>{folder.name}</span>
            </div>
            <div className={styles.itemActions}>
            </div>
          </div>
        ),
        key: `folder-${folder.id}`,
        isLeaf: children.length === 0, // Only show expand/collapse if has children
        children: children.length > 0 ? children : undefined,
      };
    };
    
    const result: DataNode[] = [];
    
    // Add all folders (all folders are root level now, no nesting)
    projectFolders.forEach((folder) => {
      result.push(buildFolderNode(folder));
    });
    
    // Add libraries without folder (folder_id is null, stored as empty string in Map)
    const rootLibraries = librariesByFolder.get('') || [];
    rootLibraries.forEach((lib) => {
      const libProjectId = lib.project_id;
      // Show selected state when on library page OR when viewing an asset in this library
      const isCurrentLibrary = currentIds.libraryId === lib.id && (currentIds.isLibraryPage || !!currentIds.assetId);
      // Show icons only when viewing an asset (not on library page)
      const showAssetPageIcons = currentIds.libraryId === lib.id && !!currentIds.assetId;
      result.push({
        title: (
          <div 
            className={`${styles.itemRow} ${isCurrentLibrary ? (showAssetPageIcons ? styles.libraryItemActiveWithPadding : styles.libraryItemActive) : ''}`}
            onContextMenu={(e) => handleContextMenu(e, 'library', lib.id)}
          >
            <div className={styles.itemMain}>
              {showAssetPageIcons && (
                <button
                  className={styles.libraryBackButton}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (currentIds.projectId) {
                      router.push(`/${currentIds.projectId}`);
                    }
                  }}
                  title="Back to tree view"
                >
                  <Image
                    src={sidebarFolderIcon3}
                    alt="Back"
                    width={24}
                    height={24}
                  />
                </button>
              )}
              <div className={styles.libraryIconContainer}>
                <Image
                  src={libraryBookIcon}
                  alt="Library"
                  width={24}
                  height={24}
                />
              </div>
              <span className={styles.itemText}>{lib.name}</span>
            </div>
            <div className={styles.itemActions}>
              <Tooltip
                title="Predefine asset here"
                placement="top"
                color="#8B5CF6"
              >
                <button
                  className={styles.iconButton}
                  aria-label="Library sections"
                  onClick={(e) => handleLibraryPredefineClick(libProjectId, lib.id, e)}
                >
                  <Image
                    src={showAssetPageIcons ? sidebarFolderIcon4 : predefineSettingIcon}
                    alt="Predefine"
                    width={22}
                    height={22}
                  />
                </button>
              </Tooltip>
            </div>
          </div>
        ),
        key: `library-${lib.id}`,
        isLeaf: false, // Allow expand to show assets and create button
        children: [
          // Create new asset button - always first
          {
            title: (
              <button
                className={styles.createButton}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!currentIds.projectId) {
                    setError('Please select a project first');
                    return;
                  }
                  router.push(`/${libProjectId}/${lib.id}/new`);
                }}
              >
                <span className={styles.createButtonText}>
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
                  {' '}Add new asset
                </span>
              </button>
            ),
            key: `add-asset-${lib.id}`,
            isLeaf: true,
          },
          // Existing assets
          ...(assets[lib.id] || []).map<DataNode>((asset) => {
            const isCurrentAsset = currentIds.assetId === asset.id;
            return {
              title: (
                <div className={`${styles.itemRow} ${isCurrentAsset ? styles.assetItemActive : ''}`}>
                  <div className={styles.itemMain}>
                    <span className={styles.itemText}>{asset.name}</span>
                  </div>
                  <div className={styles.itemActions}>
                  </div>
                </div>
              ),
              key: `asset-${asset.id}`,
              isLeaf: true,
            };
          }),
        ],
      });
    });
    
    return result;
  }, [folders, libraries, assets, currentIds.projectId, currentIds.libraryId, currentIds.isLibraryPage, currentIds.assetId, handleLibraryPredefineClick, router]);

  const selectedKey = useMemo(() => {
    const keys: string[] = [];
    
    // Add selected folder from URL
    if (currentIds.folderId) {
      keys.push(`folder-${currentIds.folderId}`);
    }
    
    // Add selected library or asset
    if (currentIds.libraryId) {
      if (currentIds.assetId && currentIds.assetId !== 'new' && currentIds.assetId !== 'predefine') {
        // Asset: /[projectId]/[libraryId]/[assetId]
        keys.push(`asset-${currentIds.assetId}`);
        // Also select the library when viewing an asset
        keys.push(`library-${currentIds.libraryId}`);
      } else if (currentIds.isLibraryPage) {
        // Library: /[projectId]/[libraryId]
        keys.push(`library-${currentIds.libraryId}`);
      }
    }
    
    return keys;
  }, [pathname, currentIds.folderId, currentIds.libraryId, currentIds.assetId, currentIds.isLibraryPage]);

  const onSelect = (_keys: React.Key[], info: any) => {
    const key: string = info.node.key;
    if (key.startsWith('folder-create-')) {
      // Handle create button click - button's onClick will handle this
      // This is just a fallback in case onSelect is called
      const folderId = key.replace('folder-create-', '');
      setSelectedFolderId(folderId);
    } else if (key.startsWith('add-asset-')) {
      // Handle create asset button click - button's onClick will handle this
      // This is just a fallback in case onSelect is called
      const libraryId = key.replace('add-asset-', '');
      const lib = libraries.find((l) => l.id === libraryId);
      if (lib && currentIds.projectId) {
        router.push(`/${currentIds.projectId}/${libraryId}/new`);
      }
    } else if (key.startsWith('folder-')) {
      const id = key.replace('folder-', '');
      // Navigate to folder page
      if (currentIds.projectId) {
        router.push(`/${currentIds.projectId}/folder/${id}`);
      }
    } else if (key.startsWith('library-')) {
      const id = key.replace('library-', '');
      setSelectedFolderId(null); // Clear folder selection when library is selected
      const projId = libraries.find((l) => l.id === id)?.project_id || currentIds.projectId || '';
      handleLibraryClick(projId, id);
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
        handleAssetClick(projId, libId, assetId);
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

  // Custom expand/collapse icon
  const switcherIcon = ({ expanded }: { expanded: boolean }) => {
    return (
      <Image
        src={expanded ? folderExpandIcon : folderCollapseIcon}
        alt={expanded ? "Expand" : "Collapse"}
        width={expanded ? 14 : 8}
        height={expanded ? 8 : 14}
        style={{ display: 'block' }}
      />
    );
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

  const handleContextMenuAction = (action: ContextMenuAction) => {
    if (!contextMenu) return;
    
    // TODO: Implement actions
    console.log(`Action: ${action} on ${contextMenu.type} with id: ${contextMenu.id}`);
    
    // For now, only handle delete action
    if (action === 'delete') {
      if (contextMenu.type === 'project') {
        if (window.confirm('Delete this project? All libraries under it will be removed.')) {
          deleteProject(supabase, contextMenu.id).then(() => {
            fetchProjects();
            // If currently viewing the deleted project, navigate to home
            if (currentIds.projectId === contextMenu.id) {
              router.push('/');
            }
          }).catch((err: any) => {
            setError(err?.message || 'Failed to delete project');
          });
        }
      } else if (contextMenu.type === 'library') {
        if (window.confirm('Delete this library?')) {
          const libraryToDelete = libraries.find(lib => lib.id === contextMenu.id);
          const deletedFolderId = libraryToDelete?.folder_id || null;
          deleteLibrary(supabase, contextMenu.id).then(() => {
            fetchFoldersAndLibraries(currentIds.projectId!);
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
            fetchFoldersAndLibraries(currentIds.projectId!);
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
                  await fetchAssets(libraryId);
                  window.dispatchEvent(new CustomEvent('assetDeleted', { detail: { libraryId } }));
                  // Check if currently viewing this asset, if so navigate to library page
                  const parts = pathname.split("/").filter(Boolean);
                  if (parts.length >= 3 && parts[2] === contextMenu.id && currentIds.projectId) {
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
    try {
      await deleteProject(supabase, projectId);
      if (currentIds.projectId === projectId) {
        router.push('/');
      }
      fetchProjects();
      setLibraries([]);
    } catch (err: any) {
      setError(err?.message || 'Failed to delete project');
    }
  };
  const handleProjectCreated = async (projectId: string, defaultFolderId: string) => {
    console.log('Project created:', { projectId, defaultFolderId });
    setShowProjectModal(false);
    setLoadingAfterCreate(true);
    setCreateMessage('Project created, loading...');
    await fetchProjects();
    // Dispatch event to notify other components (like ProjectsPage) to refresh
    window.dispatchEvent(new CustomEvent('projectCreated'));
    // Navigate to the new project and refresh folders/libraries
    if (projectId) {
      router.push(`/${projectId}`);
      // Refresh folders and libraries after navigation
      // Use setTimeout to ensure navigation completes first
      setTimeout(async () => {
        await fetchFoldersAndLibraries(projectId);
        setLoadingAfterCreate(false);
        setCreateMessage('');
      }, 100);
    } else {
      setLoadingAfterCreate(false);
      setCreateMessage('');
    }
  };

  const handleLibraryCreated = async (libraryId: string) => {
    setShowLibraryModal(false);
    const createdFolderId = selectedFolderId;
    setSelectedFolderId(null); // Clear selection after creation
    setLoadingAfterCreate(true);
    setCreateMessage('Library created, loading...');
    await fetchFoldersAndLibraries(currentIds.projectId);
    setLoadingAfterCreate(false);
    setCreateMessage('');
    // Dispatch event to notify FolderPage to refresh
    window.dispatchEvent(new CustomEvent('libraryCreated', {
      detail: { folderId: createdFolderId, libraryId }
    }));
  };

  const handleFolderCreated = async () => {
    setShowFolderModal(false);
    setSelectedFolderId(null); // Clear selection after creation
    setLoadingAfterCreate(true);
    setCreateMessage('Folder created, loading...');
    await fetchFoldersAndLibraries(currentIds.projectId);
    setLoadingAfterCreate(false);
    setCreateMessage('');
    // Dispatch event to notify ProjectPage to refresh
    window.dispatchEvent(new CustomEvent('folderCreated'));
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
    setShowFolderModal(true);
  };

  const handleCreateLibrary = () => {
    setShowAddMenu(false);
    if (!currentIds.projectId) {
      setError('Please select a project first');
      return;
    }
    // selectedFolderId is already set when button is clicked
    setShowLibraryModal(true);
  };

  return (
    <aside className={styles.sidebar}>
      <div className={styles.header}>
        <div className={styles.headerLogo}>
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
        {!currentIds.isPredefinePage && !currentIds.assetId && (
          <>
            <div className={styles.sectionTitle}>
              <span>Projects</span>
              <button
                className={styles.addButton}
                onClick={() => setShowProjectModal(true)}
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
            {loadingProjects && <div className={styles.hint}>Loading projects...</div>}
            {loadingAfterCreate && <div className={styles.loadingAfterCreate}>{createMessage}</div>}
            <div className={styles.sectionList}>
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
                  onClick={() => setShowProjectModal(true)}
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
              {!currentIds.isPredefinePage && !currentIds.assetId && (
                <div className={styles.sectionTitle}>
                  <span>Libraries</span>
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
                </div>
              )}
              {(loadingFolders || loadingLibraries) && !currentIds.isPredefinePage && (
                <div className={styles.hint}>Loading libraries...</div>
              )}
              <div className={styles.sectionList}>
                {currentIds.isPredefinePage && currentIds.libraryId ? (
                  // Predefine page: Show special view with close button
                  (() => {
                    const currentLibrary = libraries.find(lib => lib.id === currentIds.libraryId);
                    const libraryName = currentLibrary?.name || 'Library';
                    return (
                      <div className={styles.predefineItem}>
                        <button
                          className={`${styles.iconButton} ${styles.predefineCloseButton}`}
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
                            alt="Close"
                            width={24}
                            height={24}
                          />
                        </button>
                        <div className={styles.predefineItemMain}>
                          <Image
                            src={sidebarFolderIcon}
                            alt="Library"
                            width={24}
                            height={24}
                          />
                          <span className={styles.itemText} style={{ fontWeight: 500 }}>
                            Predefine {libraryName} Library
                          </span>
                        </div>
                      </div>
                    );
                  })()
                ) : currentIds.assetId && currentIds.libraryId ? (
                  // Asset page: Show library with assets list
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
                                if (currentIds.projectId) {
                                  router.push(`/${currentIds.projectId}`);
                                }
                              }}
                              title="Back to tree view"
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
                            <span className={styles.itemText}>{libraryName}</span>
                          </div>
                          <div className={styles.itemActions}>
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
                          </div>
                        </div>
                        {/* Add new asset button */}
                        <button
                          className={`${styles.createButton} ${styles.createButtonAligned}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (currentIds.projectId && currentIds.libraryId) {
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
                            {' '}Add new asset
                          </span>
                        </button>
                        {/* Assets list */}
                        <div className={styles.assetList}>
                          {libraryAssets.map((asset) => {
                            const isCurrentAsset = currentIds.assetId === asset.id;
                            return (
                              <div
                                key={asset.id}
                                className={`${styles.itemRow} ${isCurrentAsset ? styles.assetItemActive : ''}`}
                                onClick={() => {
                                  if (currentIds.projectId && currentIds.libraryId) {
                                    handleAssetClick(currentIds.projectId, currentIds.libraryId, asset.id);
                                  }
                                }}
                                onContextMenu={(e) => handleContextMenu(e, 'asset', asset.id)}
                              >
                                <div className={styles.itemMain}>
                                  <span className={styles.itemText}>{asset.name}</span>
                                </div>
                                <div className={styles.itemActions}>
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
                        selectedKeys={selectedKey}
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
                        <div className={styles.hint}>No libraries. Create one.</div>
                      )}
                  </>
                )}
              </div>
            </>
          )}
      </div>

      <NewProjectModal
        open={showProjectModal}
        onClose={() => setShowProjectModal(false)}
        onCreated={handleProjectCreated}
      />

      <NewLibraryModal
        open={showLibraryModal}
        onClose={() => setShowLibraryModal(false)}
        projectId={currentIds.projectId || ''}
        folderId={selectedFolderId}
        onCreated={handleLibraryCreated}
      />

      <NewFolderModal
        open={showFolderModal}
        onClose={() => setShowFolderModal(false)}
        projectId={currentIds.projectId || ''}
        onCreated={handleFolderCreated}
      />

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
          onClose={() => setContextMenu(null)}
          onAction={handleContextMenuAction}
        />
      )}
    </aside>
  );
}

