'use client';

import projectIcon from "@/app/assets/images/projectIcon.svg";
import libraryIcon from "@/app/assets/images/libraryIcon.svg";
import loginProductIcon from "@/app/assets/images/loginProductIcon.svg";
import predefineSettingIcon from "@/app/assets/images/predefineSettingIcon.svg";
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

  const currentIds = useMemo(() => {
    const parts = pathname.split("/").filter(Boolean);
    // Handle /[projectId]/[libraryId] structure
    const projectId = parts[0] || null;
    const libraryId = parts[1] || null;
    return { projectId, libraryId };
  }, [pathname]);

  const fetchProjects = async () => {
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
  };

  const fetchFoldersAndLibraries = async (projectId?: string | null) => {
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
  };

  useEffect(() => {
    fetchProjects();
  }, []);

  useEffect(() => {
    fetchFoldersAndLibraries(currentIds.projectId);
  }, [currentIds.projectId]);

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

  const handleLibraryPredefineClick = (projectId: string, libraryId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    router.push(`/${projectId}/${libraryId}/predefine`);
  };

  const handleAssetClick = (projectId: string, libraryId: string, assetId: string) => {
    router.push(`/${projectId}/${libraryId}/${assetId}`);
  };

  const handleAssetDelete = async (
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
  };

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
        folders: projectFolders.map(f => ({ id: f.id, name: f.name, parent_folder_id: f.parent_folder_id }))
      });
    }
    
    // Group folders by parent_folder_id
    const foldersByParent = new Map<string | null, Folder[]>();
    projectFolders.forEach((folder) => {
      const parentId = folder.parent_folder_id;
      if (!foldersByParent.has(parentId)) {
        foldersByParent.set(parentId, []);
      }
      foldersByParent.get(parentId)!.push(folder);
    });
    
    // Recursive function to build folder tree
    const buildFolderNode = (folder: Folder): DataNode => {
      const childFolders = foldersByParent.get(folder.id) || [];
      // Get libraries for this folder (folder.id is string, so it matches Map key)
      // Ensure folder.id is converted to string for Map lookup
      const folderLibraries = librariesByFolder.get(String(folder.id)) || [];
      
      // Debug: log folder node building
      if (process.env.NODE_ENV === 'development') {
        console.log(`Building folder node: ${folder.name} (id: ${folder.id})`, {
          childFolders: childFolders.length,
          folderLibraries: folderLibraries.length,
          folderLibrariesNames: folderLibraries.map(l => l.name)
        });
      }
      
      // Create button node for "Create new library" - always first child
      const createButtonNode: DataNode = {
        title: (
          <button
            className={styles.createButton}
            onClick={(e) => {
              e.stopPropagation();
              setSelectedFolderId(folder.id);
              setAddButtonRef(e.currentTarget);
              setShowAddMenu(true);
            }}
          >
            <span className={styles.createButtonText}>+ Create new library</span>
          </button>
        ),
        key: `folder-create-${folder.id}`,
        isLeaf: true,
      };
      
      const children: DataNode[] = [
        createButtonNode, // Always first
        ...childFolders.map(buildFolderNode),
        ...folderLibraries.map((lib) => {
          const libProjectId = lib.project_id;
          return {
            title: (
              <div className={styles.itemRow}>
                <div className={styles.itemMain}>
                  <Image
                    src={libraryIcon}
                    alt="Library"
                    width={16}
                    height={16}
                    className={styles.itemIcon}
                  />
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
            isLeaf: true, // Library is the last entity, no expand/collapse button
            children: (assets[lib.id] || []).length > 0 ? (assets[lib.id] || []).map<DataNode>((asset) => ({
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
            })) : undefined,
          };
        }),
      ];
      
      return {
        title: (
          <div className={styles.itemRow}>
            <div className={styles.itemMain}>
              <span className={styles.itemText} style={{ fontWeight: 500 }}>{folder.name}</span>
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
        isLeaf: children.length === 0, // Only show expand/collapse if has children
        children: children.length > 0 ? children : undefined,
      };
    };
    
    const result: DataNode[] = [];
    
    // Add root folders (parent_folder_id is null)
    const rootFolders = foldersByParent.get(null) || [];
    rootFolders.forEach((folder) => {
      result.push(buildFolderNode(folder));
    });
    
    // Add libraries without folder (folder_id is null, stored as empty string in Map)
    const rootLibraries = librariesByFolder.get('') || [];
    rootLibraries.forEach((lib) => {
      const libProjectId = lib.project_id;
      result.push({
        title: (
          <div className={styles.itemRow}>
            <div className={styles.itemMain}>
              <Image
                src={libraryIcon}
                alt="Library"
                width={16}
                height={16}
                className={styles.itemIcon}
              />
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
        isLeaf: true, // Library is the last entity, no expand/collapse button
        children: (assets[lib.id] || []).length > 0 ? (assets[lib.id] || []).map<DataNode>((asset) => ({
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
        })) : undefined,
      });
    });
    
    return result;
  }, [folders, libraries, assets, currentIds.projectId, handleLibraryPredefineClick, handleAssetDelete]);

  const selectedKey = useMemo(() => {
    const parts = pathname.split("/").filter(Boolean);
    const keys: string[] = [];
    
    // Add selected folder if any
    if (selectedFolderId) {
      keys.push(`folder-${selectedFolderId}`);
    }
    
    // Add selected library or asset
    if (parts.length >= 3) {
      keys.push(`asset-${parts[2]}`);
    } else if (parts.length === 2) {
      keys.push(`library-${parts[1]}`);
    }
    
    return keys;
  }, [pathname, selectedFolderId]);

  const onSelect = (_keys: React.Key[], info: any) => {
    const key: string = info.node.key;
    if (key.startsWith('folder-create-')) {
      // Handle create button click - button's onClick will handle this
      // This is just a fallback in case onSelect is called
      const folderId = key.replace('folder-create-', '');
      setSelectedFolderId(folderId);
    } else if (key.startsWith('folder-')) {
      const id = key.replace('folder-', '');
      setSelectedFolderId(id);
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

  const onExpand = async (_keys: React.Key[], info: { node: EventDataNode }) => {
    const key = info.node.key as string;
    if (key.startsWith('library-')) {
      const id = key.replace('library-', '');
      if (!assets[id]) {
        await fetchAssets(id);
      }
    }
    // Folders don't need to fetch anything on expand
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

  const handleLibraryDelete = async (libraryId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm('Delete this library?')) return;
    try {
      await deleteLibrary(supabase, libraryId);
      fetchFoldersAndLibraries(currentIds.projectId);
    } catch (err: any) {
      setError(err?.message || 'Failed to delete library');
    }
  };

  const handleFolderDelete = async (folderId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm('Delete this folder? All libraries and subfolders under it will be removed.')) return;
    try {
      await deleteFolder(supabase, folderId);
      fetchFoldersAndLibraries(currentIds.projectId);
    } catch (err: any) {
      setError(err?.message || 'Failed to delete folder');
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

  const handleLibraryCreated = () => {
    setShowLibraryModal(false);
    setSelectedFolderId(null); // Clear selection after creation
    fetchFoldersAndLibraries(currentIds.projectId);
  };

  const handleFolderCreated = () => {
    setShowFolderModal(false);
    setSelectedFolderId(null); // Clear selection after creation
    fetchFoldersAndLibraries(currentIds.projectId);
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

        {currentIds.projectId && projects.length > 0 && projects.some((p) => p.id === currentIds.projectId) && (
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
            {(loadingFolders || loadingLibraries) && <div className={styles.hint}>Loading libraries...</div>}
        <div className={styles.sectionList}>
          <div className={styles.treeWrapper}>
            <Tree
              className={styles.tree}
              showIcon={false}
              treeData={treeData}
              selectedKeys={selectedKey}
              onSelect={onSelect}
              onExpand={onExpand}
                  defaultExpandedKeys={folders.map((f) => `folder-${f.id}`)}
                  defaultExpandAll={false}
            />
          </div>
              {!loadingFolders && !loadingLibraries && folders.length === 0 && libraries.length === 0 && (
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
        onCreated={() => handleLibraryCreated()}
      />

      <NewFolderModal
        open={showFolderModal}
        onClose={() => setShowFolderModal(false)}
        projectId={currentIds.projectId || ''}
        parentFolderId={selectedFolderId}
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


