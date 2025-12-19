'use client';

import projectIcon from "@/app/assets/images/projectIcon.svg";
import libraryIconLeft from "@/app/assets/images/libraryIconLeft.svg";
import libraryIconRight from "@/app/assets/images/libraryIconRight.svg";
import loginProductIcon from "@/app/assets/images/loginProductIcon.svg";
import predefineSettingIcon from "@/app/assets/images/predefineSettingIcon.svg";
import folderExpandIcon from "@/app/assets/images/folderExpandIcon.svg";
import folderCollapseIcon from "@/app/assets/images/folderCollapseIcon.svg";
import folderIcon from "@/app/assets/images/folderIcon.svg";
import plusHorizontal from "@/app/assets/images/plusHorizontal.svg";
import plusVertical from "@/app/assets/images/plusVertical.svg";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Tree } from "antd";
import { DataNode, EventDataNode } from "antd/es/tree";
import { useSupabase } from "@/lib/SupabaseContext";
import { NewProjectModal } from "@/components/projects/NewProjectModal";
import { NewLibraryModal } from "@/components/libraries/NewLibraryModal";
import { NewFolderModal } from "@/components/folders/NewFolderModal";
import { AddLibraryMenu } from "@/components/libraries/AddLibraryMenu";
import { listProjects, Project, deleteProject } from "@/lib/services/projectService";
import { listLibraries, Library, deleteLibrary } from "@/lib/services/libraryService";
import { listFolders, Folder, deleteFolder } from "@/lib/services/folderService";
import { SupabaseClient } from "@supabase/supabase-js";
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

  const currentIds = useMemo(() => {
    const parts = pathname.split("/").filter(Boolean);
    // Handle /[projectId]/[libraryId] or /[projectId]/folder/[folderId] structure
    const projectId = parts[0] || null;
    let libraryId: string | null = null;
    let folderId: string | null = null;
    
    if (parts.length >= 2 && parts[1] === 'folder' && parts[2]) {
      // URL format: /[projectId]/folder/[folderId]
      folderId = parts[2];
    } else if (parts.length >= 2) {
      // URL format: /[projectId]/[libraryId]
      libraryId = parts[1];
    }
    
    return { projectId, libraryId, folderId };
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

  // Keep sidebar projects in sync:
  // - initial mount
  // - whenever the route changes (e.g. project created from /projects and we navigate to /[projectId])
  useEffect(() => {
    fetchProjects();
  }, [pathname, fetchProjects]);

  // 跟踪当前项目ID，用于检测项目切换
  const prevProjectIdRef = useRef<string | null>(null);

  useEffect(() => {
    fetchFoldersAndLibraries(currentIds.projectId);
    // 切换项目时重置展开状态
    if (prevProjectIdRef.current !== currentIds.projectId) {
      setExpandedKeys([]);
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


  // 监听libraryCreated事件，当从其他页面创建library时刷新Sidebar数据
  useEffect(() => {
    const handleLibraryCreated = (event: CustomEvent) => {
      // 刷新当前项目的folders和libraries数据
      if (currentIds.projectId) {
        fetchFoldersAndLibraries(currentIds.projectId);
      }
    };

    window.addEventListener('libraryCreated' as any, handleLibraryCreated as EventListener);
    
    return () => {
      window.removeEventListener('libraryCreated' as any, handleLibraryCreated as EventListener);
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
      const { error } = await supabase
        .from('library_assets')
        .delete()
        .eq('id', assetId);
      if (error) throw error;
      await fetchAssets(libraryId);
    } catch (err) {
      console.error('Failed to delete asset', err);
    }
  }, [supabase, fetchAssets]);

  const handleLibraryDelete = useCallback(async (libraryId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm('Delete this library?')) return;
    try {
      await deleteLibrary(supabase, libraryId);
      fetchFoldersAndLibraries(currentIds.projectId);
    } catch (err: any) {
      setError(err?.message || 'Failed to delete library');
    }
  }, [supabase, currentIds.projectId, fetchFoldersAndLibraries]);

  const handleFolderDelete = useCallback(async (folderId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm('Delete this folder? All libraries and subfolders under it will be removed.')) return;
    try {
      await deleteFolder(supabase, folderId);
      fetchFoldersAndLibraries(currentIds.projectId);
    } catch (err: any) {
      setError(err?.message || 'Failed to delete folder');
    }
  }, [supabase, currentIds.projectId, fetchFoldersAndLibraries]);

  const treeData: DataNode[] = useMemo(() => {
    if (!currentIds.projectId) return [];

    // Filter folders and libraries for current project
    const projectFolders = folders.filter((f) => f.project_id === currentIds.projectId);
    const projectLibraries = libraries.filter((lib) => lib.project_id === currentIds.projectId);

    // Group libraries by folder_id (string keys)
    const librariesByFolder = new Map<string, Library[]>();
    projectLibraries.forEach((lib) => {
      const folderId = lib.folder_id ? String(lib.folder_id) : '';
      if (!librariesByFolder.has(folderId)) {
        librariesByFolder.set(folderId, []);
      }
      librariesByFolder.get(folderId)!.push(lib);
    });

    const buildFolderNode = (folder: Folder): DataNode => {
      const folderLibraries = librariesByFolder.get(String(folder.id)) || [];

      const createButtonNode: DataNode = {
        title: (
          <button
            className={styles.createButton}
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
        createButtonNode,
        ...folderLibraries.map((lib) => {
          const libProjectId = lib.project_id;

          const assetChildren: DataNode[] = (assets[lib.id] || []).map<DataNode>((asset) => ({
            title: (
              <div className={styles.itemRow}>
                <div className={styles.itemMain}>
                  <span className={styles.itemText}>{asset.name}</span>
                </div>
                <div className={styles.itemActions}>
                  <button
                    className={styles.iconButton}
                    aria-label="Delete asset"
                    onClick={(e) => handleAssetDelete(asset.id, lib.id, e)}
                  >
                    ×
                  </button>
                </div>
              </div>
            ),
            key: `asset-${asset.id}`,
            isLeaf: true,
          }));

          const addAssetNode: DataNode = {
            title: (
              <div className={styles.itemRow}>
                <div className={styles.itemMain}>
                  <span className={styles.itemAddIcon}>+</span>
                  <span className={styles.itemAddText}>Add New Asset</span>
                </div>
              </div>
            ),
            key: `add-asset-${lib.id}`,
            isLeaf: true,
          };

          return {
            title: (
              <div className={styles.itemRow}>
                <div className={styles.itemMain}>
                  <div className={styles.libraryIconContainer}>
                    <Image
                      src={libraryIconLeft}
                      alt=""
                      width={12}
                      height={20}
                      className={styles.libraryIconPart}
                    />
                    <Image
                      src={libraryIconRight}
                      alt=""
                      width={12}
                      height={20}
                      className={styles.libraryIconPart}
                    />
                  </div>
                  <span className={styles.itemText}>{lib.name}</span>
                </div>
                <div className={styles.itemActions}>
                  <button
                    className={styles.iconButton}
                    aria-label="Library sections"
                    onClick={(e) => handleLibraryPredefineClick(libProjectId, lib.id, e)}
                  >
                    <Image
                      src={predefineSettingIcon}
                      alt="Predefine"
                      width={22}
                      height={22}
                    />
                  </button>
                  <button
                    className={styles.iconButton}
                    aria-label="Delete library"
                    onClick={(e) => handleLibraryDelete(lib.id, e)}
                  >
                    ×
                  </button>
                </div>
              </div>
            ),
            key: `library-${lib.id}`,
            isLeaf: false,
            children: [addAssetNode, ...assetChildren],
          };
        }),
      ];

      return {
        title: (
          <div className={styles.itemRow}>
            <div className={styles.itemMain}>
              <Image
                src={folderIcon}
                alt="Folder"
                width={22}
                height={18}
                className={styles.itemIcon}
              />
              <span className={styles.itemText} style={{ fontWeight: 500 }}>
                {folder.name}
              </span>
            </div>
            <div className={styles.itemActions}>
              <button
                className={styles.iconButton}
                aria-label="Delete folder"
                onClick={(e) => handleFolderDelete(folder.id, e)}
              >
                ×
              </button>
            </div>
          </div>
        ),
        key: `folder-${folder.id}`,
        isLeaf: children.length === 0,
        children: children.length > 0 ? children : undefined,
      };
    };

    const result: DataNode[] = [];

    projectFolders.forEach((folder) => {
      result.push(buildFolderNode(folder));
    });

    const rootLibraries = librariesByFolder.get('') || [];
    rootLibraries.forEach((lib) => {
      const libProjectId = lib.project_id;

      const assetChildren: DataNode[] = (assets[lib.id] || []).map<DataNode>((asset) => ({
        title: (
          <div className={styles.itemRow}>
            <div className={styles.itemMain}>
              <span className={styles.itemText}>{asset.name}</span>
            </div>
            <div className={styles.itemActions}>
              <button
                className={styles.iconButton}
                aria-label="Delete asset"
                onClick={(e) => handleAssetDelete(asset.id, lib.id, e)}
              >
                ×
              </button>
            </div>
          </div>
        ),
        key: `asset-${asset.id}`,
        isLeaf: true,
      }));

      const addAssetNode: DataNode = {
        title: (
          <div className={styles.itemRow}>
            <div className={styles.itemMain}>
              <span className={styles.itemAddIcon}>+</span>
              <span className={styles.itemAddText}>Add New Asset</span>
            </div>
          </div>
        ),
        key: `add-asset-${lib.id}`,
        isLeaf: true,
      };

      result.push({
        title: (
          <div className={styles.itemRow}>
            <div className={styles.itemMain}>
              <div className={styles.libraryIconContainer}>
                <Image
                  src={libraryIconLeft}
                  alt=""
                  width={12}
                  height={20}
                  className={styles.libraryIconPart}
                />
                <Image
                  src={libraryIconRight}
                  alt=""
                  width={12}
                  height={20}
                  className={styles.libraryIconPart}
                />
              </div>
              <span className={styles.itemText}>{lib.name}</span>
            </div>
            <div className={styles.itemActions}>
              <button
                className={styles.iconButton}
                aria-label="Library sections"
                onClick={(e) => handleLibraryPredefineClick(libProjectId, lib.id, e)}
              >
                <Image
                  src={predefineSettingIcon}
                  alt="Predefine"
                  width={18}
                  height={18}
                />
              </button>
              <button
                className={styles.iconButton}
                aria-label="Delete library"
                onClick={(e) => handleLibraryDelete(lib.id, e)}
              >
                ×
              </button>
            </div>
          </div>
        ),
        key: `library-${lib.id}`,
        isLeaf: false,
        children: [addAssetNode, ...assetChildren],
      });
    });

    return result;
  }, [folders, libraries, assets, currentIds.projectId, handleLibraryPredefineClick, handleAssetDelete, handleFolderDelete, handleLibraryDelete]);

  const selectedKey = useMemo(() => {
    const keys: string[] = [];
    
    // Add selected folder from URL
    if (currentIds.folderId) {
      keys.push(`folder-${currentIds.folderId}`);
    }
    
    // Add selected library or asset
    if (currentIds.libraryId) {
      const parts = pathname.split("/").filter(Boolean);
      if (parts.length >= 3 && parts[1] !== 'folder') {
        // Asset: /[projectId]/[libraryId]/[assetId]
        keys.push(`asset-${parts[2]}`);
      } else {
        // Library: /[projectId]/[libraryId]
        keys.push(`library-${currentIds.libraryId}`);
      }
    }
    
    return keys;
  }, [pathname, currentIds.folderId, currentIds.libraryId]);

  const onSelect = (_keys: React.Key[], info: any) => {
    const key: string = info.node.key;
    if (key.startsWith('add-asset-')) {
      const libId = key.replace('add-asset-', '');
      const lib = libraries.find((l) => l.id === libId);
      const projId = lib?.project_id || currentIds.projectId;
      if (projId && libId) {
        router.push(`/${projId}/${libId}/asset/new`);
      }
    } else if (key.startsWith('folder-create-')) {
      // Fallback: button itself handles click, but keep selection in sync
      const folderId = key.replace('folder-create-', '');
      setSelectedFolderId(folderId);
    } else if (key.startsWith('folder-')) {
      const id = key.replace('folder-', '');
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
    // 更新展开状态
    setExpandedKeys(keys);
    
    const key = info.node.key as string;
    if (key.startsWith('library-')) {
      const id = key.replace('library-', '');
      if (!assets[id]) {
        await fetchAssets(id);
      }
    }
    // Folders don't need to fetch anything on expand
  };

  // 自定义展开/折叠图标
  const switcherIcon = ({ expanded }: { expanded: boolean }) => {
    return (
      <Image
        src={expanded ? folderExpandIcon : folderCollapseIcon}
        alt={expanded ? "展开" : "折叠"}
        width={expanded ? 14 : 8}
        height={expanded ? 8 : 14}
        style={{ display: 'block' }}
      />
    );
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

  const handleProjectCreated = (projectId: string, defaultFolderId: string) => {
    console.log('Project created:', { projectId, defaultFolderId });
    setShowProjectModal(false);
    fetchProjects();
    // Optionally navigate to the new project
    if (projectId) {
      router.push(`/${projectId}`);
    }
  };

  const handleLibraryCreated = (libraryId: string) => {
    setShowLibraryModal(false);
    const createdFolderId = selectedFolderId;
    setSelectedFolderId(null); // Clear selection after creation
    fetchFoldersAndLibraries(currentIds.projectId);
    // Dispatch event to notify FolderPage to refresh
    window.dispatchEvent(new CustomEvent('libraryCreated', {
      detail: { folderId: createdFolderId, libraryId }
    }));
  };

  const handleFolderCreated = () => {
    setShowFolderModal(false);
    setSelectedFolderId(null); // Clear selection after creation
    fetchFoldersAndLibraries(currentIds.projectId);
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
          <span className={styles.searchIcon}>⌕</span>
          <input
            placeholder="Search for..."
            className={styles.searchInput}
          />
        </label>
      </div>

      <div className={styles.content}>
        <div className={styles.sectionTitle}>
          <span>Projects</span>
          <button
            className={styles.addButton}
            onClick={() => setShowProjectModal(true)}
            title="New Project"
          >
            +
          </button>
        </div>
        {loadingProjects && <div className={styles.hint}>Loading projects...</div>}
        <div className={styles.sectionList}>
          {projects.map((project) => {
            const isActive = currentIds.projectId === project.id;
            return (
              <div
                key={project.id}
                className={`${styles.item} ${isActive ? styles.itemActive : styles.itemInactive}`}
                onClick={() => handleProjectClick(project.id)}
              >
                <Image
                  src={projectIcon}
                  alt="Project"
                  width={20}
                  height={20}
                  className={styles.itemIcon}
                />
                <span className={styles.itemText}>{project.name}</span>
                <span className={styles.itemActions}>
                  <button
                    className={styles.iconButton}
                    aria-label="Delete project"
                    onClick={(e) => handleProjectDelete(project.id, e)}
                  >
                    ×
                  </button>
                </span>
              </div>
            );
          })}
          {!loadingProjects && projects.length === 0 && (
            <div className={styles.hint}>No projects. Create one.</div>
          )}
        </div>

        {currentIds.projectId &&
          projects.length > 0 &&
          projects.some((p) => p.id === currentIds.projectId) && (
            <>
              <div className={styles.sectionTitle}>
                <span>Libraries</span>
                <button
                  ref={setAddButtonRef}
                  className={styles.addButton}
                  onClick={handleAddButtonClick}
                  title="Add new folder or library"
                >
                  +
                </button>
              </div>
              {(loadingFolders || loadingLibraries) && (
                <div className={styles.hint}>Loading libraries...</div>
              )}
              <div className={styles.sectionList}>
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
    </aside>
  );
}


