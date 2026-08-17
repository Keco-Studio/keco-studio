'use client';

import searchIcon from "@/assets/images/searchIcon.svg";
import moveToSearchIcon from "@/assets/images/moveToSearch.svg";
import moveToCloseIcon from "@/assets/images/moveToClose.svg";
import moveToFolderIcon from "@/assets/images/moveToFolder.svg";
import moveToFolderDisabledIcon from "@/assets/images/moveToFolder2.svg";
import moveToSelectIcon from "@/assets/images/moveToSelect.svg";
import Image from "next/image";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter, usePathname } from "next/navigation";
import { EventDataNode } from "antd/es/tree";
import { Modal } from "antd";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigation } from "@/lib/contexts/NavigationContext";
import { useSupabase } from "@/lib/SupabaseContext";
import { queryKeys } from "@/lib/utils/queryKeys";
import { normalizeSearchString } from "@/lib/utils/normalizeSearchString";
import { NewProjectModal } from "@/components/projects/NewProjectModal";
import { EditProjectModal } from "@/components/projects/EditProjectModal";
import { NewLibraryModal } from "@/components/libraries/NewLibraryModal";
import { EditLibraryModal } from "@/components/libraries/EditLibraryModal";
import { DuplicateLibraryModal } from "@/components/libraries/DuplicateLibraryModal";
import { ImportScriptModal } from "@/components/libraries/ImportScriptModal";
import { NewFolderModal } from "@/components/folders/NewFolderModal";
import { EditFolderModal } from "@/components/folders/EditFolderModal";
import { EditAssetModal } from "@/components/asset/EditAssetModal";
import { AddLibraryMenu } from "@/components/libraries/AddLibraryMenu";
import { Project } from "@/lib/services/projectService";
import { Library, deleteLibrary, moveLibraryToFolder, detachLibraryFromDocument } from "@/lib/services/libraryService";
import { Folder, deleteFolder, duplicateFolder, moveFolderToParent } from "@/lib/services/folderService";
import {
  moveDocument,
  updateDocumentName,
  type DocumentRecord,
  type DocumentSummary,
} from "@/lib/services/documentService";
import { broadcastProjectDocumentUpdate } from "@/lib/documents/projectDocumentChannel";
import { flushOpenDocumentEditor } from "@/lib/documents/documentFlushRegistry";
import { notifyDocumentDerivedLibraryCreated } from "@/lib/documents/documentDerivedLibraryEvents";
import { runDocumentDerivedImport } from "@/lib/documents/runDocumentDerivedImport";
import { showErrorToast, showSuccessToast } from "@/lib/utils/toast";
import { resolveSidebarDrop } from "./sidebarTreeDnD";
import {
  createSidebarOptimisticMove,
  runOptimisticSidebarMutation,
} from './sidebarOptimisticPlacement';
import type { SidebarTreeDropInfo } from "./components/SidebarTreeView";
import { NewDocumentModal } from "@/components/documents/NewDocumentModal";
import { EditDocumentModal } from "@/components/documents/EditDocumentModal";
import { MoveDocumentModal } from "@/components/documents/MoveDocumentModal";
import { useSidebarProjects } from "./hooks/useSidebarProjects";
import { useSidebarFoldersLibraries } from "./hooks/useSidebarFoldersLibraries";
import { useSidebarDocuments } from "./hooks/useSidebarDocuments";
import { useSidebarModals } from "./hooks/useSidebarModals";
import { useSidebarContextMenu } from "./hooks/useSidebarContextMenu";
import { SidebarTreeView } from "./components/SidebarTreeView";
import { SidebarProjectsList } from "./components/SidebarProjectsList";
import { SidebarProjectQuickNav } from "./components/SidebarProjectQuickNav";
import { SidebarLibrariesSection } from "./components/SidebarLibrariesSection";
import { deleteAsset } from "@/lib/services/libraryAssetsService";
import { SupabaseClient } from "@supabase/supabase-js";
import { ContextMenu } from "./ContextMenu";
import type { UserProfileDisplay } from "@/lib/types/user";
import { useSidebarTree } from "./hooks/useSidebarTree";
import { useSidebarAssets } from "./hooks/useSidebarAssets";
import { useSidebarProjectRole } from "./hooks/useSidebarProjectRole";
import { useSidebarWindowEvents } from "./hooks/useSidebarWindowEvents";
import { useSidebarRealtime } from "./hooks/useSidebarRealtime";
import {
  moveSidebarDocument,
  useSidebarContextMenuActions,
  useSidebarDocumentDerivedLibraryLifecycle,
} from "./hooks/useSidebarContextMenuActions";
import { DeleteConfirmDialog } from "./components/DeleteConfirmDialog";
import { useUpdateEntityName } from '@/lib/hooks/useCacheMutations';
import { validateName } from '@/lib/utils/nameValidation';
import {
  invalidateFolderData,
  invalidateLibraryAssetsData,
  invalidateLibraryData,
  invalidateProjectData,
} from '@/lib/queryInvalidation';
import styles from "./Sidebar.module.css";
import { primeLibraryNavigationCache } from './libraryNavigationCache';
import {
  DOCUMENT_CONTEXT_MENU_REQUEST_EVENT,
  type DocumentContextMenuRequestDetail,
} from '@/components/documents/documentContextMenuRequest';
import {
  LIBRARY_CONTEXT_MENU_REQUEST_EVENT,
  type LibraryContextMenuRequestDetail,
} from '@/components/libraries/libraryContextMenuRequest';

const ImportDocumentModal = dynamic(
  () =>
    import("@/components/documents/ImportDocumentModal").then(
      (module) => module.ImportDocumentModal
    ),
  { ssr: false }
);

const MIN_SIDEBAR_WIDTH = 218;
const MAX_SIDEBAR_WIDTH = 360;
const DEFAULT_SIDEBAR_WIDTH = 218;

const ImportLibraryModal = dynamic(
  () => import("@/components/libraries/ImportLibraryModal").then((mod) => mod.ImportLibraryModal),
  { ssr: false },
);

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
    currentDocumentId,
    isPredefinePage,
    isLibraryPage,
  } = useNavigation();
  const currentIds = useMemo(
    () => ({
      projectId: currentProjectId,
      libraryId: currentLibraryId,
      folderId: currentFolderId,
      assetId: currentAssetId,
      documentId: currentDocumentId,
      isPredefinePage,
      isLibraryPage,
    }),
    [currentProjectId, currentLibraryId, currentFolderId, currentAssetId, currentDocumentId, isPredefinePage, isLibraryPage]
  );
  const supabase = useSupabase();
  const queryClient = useQueryClient();
  const confirmDeletion = useCallback((content: string) => {
    return new Promise<boolean>((resolve) => {
      Modal.confirm({
        title: 'Confirm deletion',
        content,
        okText: 'Delete',
        cancelText: 'Cancel',
        zIndex: 11000,
        okButtonProps: { danger: true },
        onOk: () => resolve(true),
        onCancel: () => resolve(false),
      });
    });
  }, []);

  const userId = userProfile?.id;
  const { userRole, isProjectOwner } = useSidebarProjectRole(
    currentIds.projectId,
    userId
  );
  const { assets, fetchAssets } = useSidebarAssets(currentIds.libraryId);

  const modals = useSidebarModals();
  const {
    showProjectModal,
    showEditProjectModal,
    editingProjectId,
    showLibraryModal,
    showEditLibraryModal,
    editingLibraryId,
    showDuplicateLibraryModal,
    duplicatingLibraryId,
    showImportLibraryModal,
    importingFolderId,
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
    openDuplicateLibrary,
    closeDuplicateLibraryModal,
    openImportLibrary,
    closeImportLibraryModal,
    openNewFolder,
    closeFolderModal,
    openEditFolder,
    closeEditFolderModal,
    openEditAsset,
    closeEditAssetModal,
    showImportScriptModal,
    importingScriptFolderId,
    openImportScript,
    closeImportScriptModal,
    showDocumentModal,
    openNewDocument,
    closeDocumentModal,
    showEditDocumentModal,
    editingDocumentId,
    openEditDocument,
    closeEditDocumentModal,
  } = modals;

  const [showAddMenu, setShowAddMenu] = useState(false);
  const [folderAddMenu, setFolderAddMenu] = useState<{ folderId: string; anchor: HTMLElement } | null>(null);
  const [showImportDocumentModal, setShowImportDocumentModal] = useState(false);
  const [addButtonRef, setAddButtonRef] = useState<HTMLButtonElement | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedKeys, setExpandedKeys] = useState<React.Key[]>([]);
  const [isSidebarVisible, setIsSidebarVisible] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const [deleteConfirmState, setDeleteConfirmState] = useState<{
    open: boolean;
    title: string;
    content: string;
    loading: boolean;
    onConfirm?: () => Promise<void> | PromiseLike<void> | void;
  }>({
    open: false,
    title: 'Confirm deletion',
    content: '',
    loading: false,
    onConfirm: undefined,
  });
  const [showMoveLibraryModal, setShowMoveLibraryModal] = useState(false);
  const [movingLibraryId, setMovingLibraryId] = useState<string | null>(null);
  const [targetFolderId, setTargetFolderId] = useState<string | null>(null);
  const [isMovingLibrary, setIsMovingLibrary] = useState(false);
  const [moveFolderSearch, setMoveFolderSearch] = useState('');
  const [useIndependentLibrary, setUseIndependentLibrary] = useState(false);
  const [movingDocumentId, setMovingDocumentId] = useState<string | null>(null);
  const [isMovingDocument, setIsMovingDocument] = useState(false);
  const resizeStartX = useRef(0);
  const resizeStartWidth = useRef(DEFAULT_SIDEBAR_WIDTH);
  const pendingTreeDropKeysRef = useRef(new Set<string>());
  const isTreeDragPending = useCallback(
    (dragKey: string) => pendingTreeDropKeysRef.current.has(dragKey),
    []
  );
  const { contextMenu, openContextMenu, closeContextMenu } = useSidebarContextMenu();

  useEffect(() => {
    const handleDocumentContextMenuRequest = (event: Event) => {
      const detail = (event as CustomEvent<DocumentContextMenuRequestDetail>).detail;
      if (!detail?.documentId) return;
      openContextMenu(detail.x, detail.y, 'document', detail.documentId, detail.elementRef);
    };

    const handleLibraryContextMenuRequest = (event: Event) => {
      const detail = (event as CustomEvent<LibraryContextMenuRequestDetail>).detail;
      if (!detail?.libraryId) return;
      openContextMenu(detail.x, detail.y, 'library', detail.libraryId, detail.elementRef);
    };

    window.addEventListener(
      DOCUMENT_CONTEXT_MENU_REQUEST_EVENT,
      handleDocumentContextMenuRequest as EventListener
    );
    window.addEventListener(
      LIBRARY_CONTEXT_MENU_REQUEST_EVENT,
      handleLibraryContextMenuRequest as EventListener
    );
    return () => {
      window.removeEventListener(
        DOCUMENT_CONTEXT_MENU_REQUEST_EVENT,
        handleDocumentContextMenuRequest as EventListener
      );
      window.removeEventListener(
        LIBRARY_CONTEXT_MENU_REQUEST_EVENT,
        handleLibraryContextMenuRequest as EventListener
      );
    };
  }, [openContextMenu]);
  const updateName = useUpdateEntityName();

  const handleSaveRename = useCallback(
    async (key: string, newName: string) => {
      const trimmed = newName.trim();
      if (!trimmed) {
        throw new Error('Name is required');
      }

      const validationError = validateName(trimmed);
      if (validationError) {
        showErrorToast(validationError);
        throw new Error(validationError);
      }

      try {
        if (key.startsWith('project-')) {
          const id = key.replace('project-', '');
          queryClient.setQueryData<Project[]>(['projects'], (old) => {
            if (!old) return old;
            return old.map((project) => (project.id === id ? { ...project, name: trimmed } : project));
          });
          await updateName.mutateAsync({
            id,
            name: trimmed,
            entityType: 'project',
          });
          showSuccessToast('Project name updated');
          return;
        }

        const foldersLibrariesKey = currentIds.projectId
          ? (['folders-libraries', currentIds.projectId] as const)
          : null;

        if (key.startsWith('library-')) {
          const id = key.replace('library-', '');
          if (foldersLibrariesKey) {
            queryClient.setQueryData<{ folders: Folder[]; libraries: Library[] }>(foldersLibrariesKey, (old) => {
              if (!old) return old;
              return {
                ...old,
                libraries: old.libraries.map((lib) => (lib.id === id ? { ...lib, name: trimmed } : lib)),
              };
            });
          }
          await updateName.mutateAsync({
            id,
            name: trimmed,
            entityType: 'library',
          });
          showSuccessToast('Library name updated');
        } else if (key.startsWith('folder-')) {
          const id = key.replace('folder-', '');
          if (foldersLibrariesKey) {
            queryClient.setQueryData<{ folders: Folder[]; libraries: Library[] }>(foldersLibrariesKey, (old) => {
              if (!old) return old;
              return {
                ...old,
                folders: old.folders.map((folder) => (folder.id === id ? { ...folder, name: trimmed } : folder)),
              };
            });
          }
          await updateName.mutateAsync({
            id,
            name: trimmed,
            entityType: 'folder',
          });
          showSuccessToast('Folder name updated');
        } else if (key.startsWith('document-')) {
          const id = key.replace('document-', '');
          const documentsKey = currentIds.projectId
            ? queryKeys.documents(currentIds.projectId)
            : null;
          if (documentsKey) {
            queryClient.setQueryData<DocumentSummary[]>(documentsKey, (old) =>
              old ? old.map((doc) => (doc.id === id ? { ...doc, name: trimmed } : doc)) : old
            );
          }
          try {
            await updateDocumentName(supabase, id, trimmed);
            queryClient.setQueryData<DocumentRecord>(
              queryKeys.document(id),
              (old) => (old ? { ...old, name: trimmed } : old)
            );
            if (currentIds.projectId) {
              void broadcastProjectDocumentUpdate({
                documentId: id,
                projectId: currentIds.projectId,
                name: trimmed,
                action: 'rename',
              });
            }
            showSuccessToast('Document name updated');
          } catch (docErr) {
            if (currentIds.projectId) {
              queryClient.invalidateQueries({ queryKey: queryKeys.documents(currentIds.projectId) });
            }
            queryClient.invalidateQueries({ queryKey: queryKeys.document(id) });
            throw docErr;
          }
        }
      } catch (err: unknown) {
        queryClient.invalidateQueries({ queryKey: ['projects'] });
        if (currentIds.projectId) {
          const foldersLibrariesKey = ['folders-libraries', currentIds.projectId] as const;
          queryClient.invalidateQueries({ queryKey: foldersLibrariesKey });
        }
        const msg = err instanceof Error ? err.message : 'Rename failed';
        const duplicateName =
          msg.toLowerCase().includes('already exists') || msg.toLowerCase().includes('name exists');
        showErrorToast(duplicateName ? 'Name already exists, update failed' : msg);
        setError(msg);
        throw err;
      }
    },
    [updateName, setError, currentIds.projectId, queryClient, supabase]
  );

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    resizeStartX.current = e.clientX;
    resizeStartWidth.current = sidebarWidth;
  }, [sidebarWidth]);

  useEffect(() => {
    if (!isResizing) return;
    const onMove = (e: MouseEvent) => {
      const delta = e.clientX - resizeStartX.current;
      const next = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, resizeStartWidth.current + delta));
      setSidebarWidth(next);
    };
    const onUp = () => setIsResizing(false);
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing]);

  const {
    projects,
    isLoading: loadingProjects,
    error: projectsError,
    refetch: refetchProjects,
  } = useSidebarProjects(userProfile?.id);

  const {
    folders,
    libraries,
    allLibraries,
    isLoading: loadingFoldersAndLibraries,
  } = useSidebarFoldersLibraries(currentIds.projectId, {
    excludeScriptLibraries: true,
  });

  const { documents } = useSidebarDocuments(currentIds.projectId);

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
    userId,
    currentProjectId: currentIds.projectId,
    router,
  });

  // Auto-navigate to first project's Recent page on login if user has projects
  useEffect(() => {
    // Only auto-navigate if:
    // 1. User is on /projects page (pathname === '/projects')
    // 2. Projects list is loaded and not empty
    // 3. User is not a guest (userProfile exists)
    if (pathname === '/projects' && projects.length > 0 && !loadingProjects && userId) {
      const firstProject = projects[0];
      if (firstProject?.id) {
        router.push(`/${firstProject.id}/recent`);
      }
    }
  }, [pathname, projects, loadingProjects, userId, router]);

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
  // NOTE: must run even when projects is empty — a collaborator opening their very
  // first project has projects === [], and that is exactly the case to refetch for.
  useEffect(() => {
    if (currentIds.projectId && !loadingProjects) {
      const currentProjectExists = projects.some(p => p.id === currentIds.projectId);
      if (!currentProjectExists) {

        (async () => {
          try {
            await queryClient.invalidateQueries({ queryKey: ['projects'] });
            if (currentIds.projectId) {
              await queryClient.invalidateQueries({ queryKey: ['project', currentIds.projectId] });
            }
            await refetchProjects();
          } catch (error) {
            console.error('[Sidebar] Error refreshing projects:', error);
          }
        })();
      }
    }
  }, [currentIds.projectId, projects, loadingProjects, refetchProjects, queryClient]);

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

  const expandFolder = useCallback((folderId: string | null | undefined) => {
    if (!folderId) return;
    const folderKey = `folder-${folderId}`;
    setExpandedKeys((prev) => (prev.includes(folderKey) ? prev : [...prev, folderKey]));
  }, []);

  useSidebarDocumentDerivedLibraryLifecycle({
    currentProjectId: currentIds.projectId,
    documents,
    queryClient,
    expandFolder,
  });

  /**
   * Flush open document autosave before leaving the editor route. If the flush
   * fails we keep the user on the page (the editor shows the error) rather than
   * navigating away and losing unsaved edits.
   */
  const navigateWithFlush = useCallback(
    async (href: string) => {
      const flushed = await flushOpenDocumentEditor();
      if (!flushed) {
        Modal.error({
          title: 'Unsaved changes could not be saved',
          content:
            'We could not save your latest changes. Please check your connection and try again before leaving this document.',
          zIndex: 11000,
        });
        return;
      }
      router.push(href);
    },
    [router]
  );

  // actions
  const handleProjectClick = async (projectId: string) => {
    await queryClient.invalidateQueries({ queryKey: ['project', projectId] });
    await navigateWithFlush(`/${projectId}/recent`);
  };

  const handleLibraryClick = async (projectId: string, libraryId: string) => {
    const targetLibrary = libraries.find((library) => library.id === libraryId);
    if (targetLibrary) {
      primeLibraryNavigationCache(queryClient, targetLibrary);
    }
    await navigateWithFlush(`/${projectId}/${libraryId}`);
    void queryClient.invalidateQueries({ queryKey: ['project', projectId] });
    fetchAssets(libraryId);
  };

  const handleAssetClick = async (projectId: string, libraryId: string, assetId: string) => {
    await queryClient.invalidateQueries({ queryKey: ['project', projectId] });
    await queryClient.invalidateQueries({ queryKey: ['library', libraryId] });
    await queryClient.invalidateQueries({ queryKey: ['asset', assetId] });
    await navigateWithFlush(`/${projectId}/${libraryId}?asset=${assetId}`);
  };

  const handleAssetDelete = useCallback(async (
    assetId: string,
    libraryId: string,
    e: React.MouseEvent
  ) => {
    e.stopPropagation();
    const confirmed = await confirmDeletion('Delete this asset?');
    if (!confirmed) return;
    try {

      await deleteAsset(supabase, assetId);

      await invalidateLibraryAssetsData(queryClient, {
        libraryId,
        assetId,
        refetchActiveAssets: true,
      });
      await fetchAssets(libraryId);

      // If currently viewing this asset, navigate to library page
      if (currentIds.assetId === assetId && currentIds.projectId) {
        router.push(`/${currentIds.projectId}/${libraryId}`);
      }
    } catch (err) {
      console.error('Failed to delete asset', err);
      alert(err instanceof Error ? err.message : 'Failed to delete asset');
    }
  }, [supabase, fetchAssets, currentIds.projectId, currentIds.assetId, queryClient, router, confirmDeletion]);

  const handleLibraryDelete = useCallback(async (libraryId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const confirmed = await confirmDeletion('Delete this library?');
    if (!confirmed) return;
    try {
      // Get library info before deleting to know which folder it belongs to
      const libraryToDelete = libraries.find(lib => lib.id === libraryId);
      const deletedFolderId = libraryToDelete?.folder_id || null;

      await deleteLibrary(supabase, libraryId);
      await invalidateLibraryData(queryClient, {
        projectId: currentIds.projectId,
        folderId: deletedFolderId,
        libraryId,
        refetchActiveFoldersLibraries: true,
      });

      // If the deleted library is currently being viewed (including library page, predefine page, new asset page, or any asset in it), navigate to project page
      if (currentIds.libraryId === libraryId && currentIds.projectId) {
        router.push(`/${currentIds.projectId}`);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to delete library');
    }
  }, [supabase, currentIds.projectId, currentIds.libraryId, libraries, queryClient, router, confirmDeletion]);

  const handleFolderDelete = useCallback(async (folderId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const confirmed = await confirmDeletion('Delete this folder? All libraries and subfolders under it will be removed.');
    if (!confirmed) return;
    try {
      // Check if any libraries under this folder are being viewed
      const librariesInFolder = libraries.filter(lib => lib.folder_id === folderId);
      const isViewingLibraryInFolder = librariesInFolder.some(lib => lib.id === currentIds.libraryId);

      await deleteFolder(supabase, folderId);
      await invalidateFolderData(queryClient, {
        projectId: currentIds.projectId,
        folderId,
        refetchActiveFoldersLibraries: true,
      });

      // If currently viewing the folder page or a library in this folder, navigate to project page
      if (currentIds.folderId === folderId || isViewingLibraryInFolder) {
        if (currentIds.projectId) {
          router.push(`/${currentIds.projectId}`);
        }
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to delete folder');
    }
  }, [supabase, currentIds.projectId, currentIds.folderId, currentIds.libraryId, libraries, queryClient, router, confirmDeletion]);

  const onSelect = async (_keys: React.Key[], info: any) => {
    const key: string = info.node.key;
    if (key.startsWith('folder-')) {
      const id = key.replace('folder-', '');
      // Navigate to folder page
      if (currentIds.projectId) {
        await queryClient.invalidateQueries({ queryKey: ['project', currentIds.projectId] });
        await queryClient.invalidateQueries({ queryKey: ['folder', id] });
        await navigateWithFlush(`/${currentIds.projectId}/folder/${id}`);
      }
    } else if (key.startsWith('library-')) {
      const id = key.replace('library-', '');
      setSelectedFolderId(null); // Clear folder selection when library is selected
      const projId = libraries.find((l) => l.id === id)?.project_id || currentIds.projectId || '';
      await handleLibraryClick(projId, id);
    } else if (key.startsWith('document-')) {
      const id = key.replace('document-', '');
      setSelectedFolderId(null);
      if (currentIds.projectId) {
        await navigateWithFlush(`/${currentIds.projectId}/doc/${id}`);
      }
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

  const handleTreeRightClick = ({ event, node }: { event: any; node: EventDataNode }) => {
    if (!node || !node.key) return;

    const rawKey = String(node.key);
    let type: 'project' | 'library' | 'folder' | 'asset' | 'document' | null = null;
    let id: string | null = null;

    if (rawKey.startsWith('folder-')) {
      type = 'folder';
      id = rawKey.replace('folder-', '');
    } else if (rawKey.startsWith('library-')) {
      type = 'library';
      id = rawKey.replace('library-', '');
    } else if (rawKey.startsWith('document-')) {
      type = 'document';
      id = rawKey.replace('document-', '');
    } else if (rawKey.startsWith('asset-')) {
      type = 'asset';
      id = rawKey.replace('asset-', '');
    }

    if (!type || !id) return;
    // Folder actions live on the row "+" menu; skip the right-click menu.
    if (type === 'folder') return;

    event.preventDefault();
    event.stopPropagation();

    const treeNodeElement =
      (event.target as HTMLElement | null)?.closest('.ant-tree-treenode') as HTMLElement | null;

    openContextMenu(event.clientX, event.clientY, type, id, treeNodeElement || null);
  };

  // Context menu handlers
  const handleContextMenu = useCallback((e: React.MouseEvent, type: 'project' | 'library' | 'folder' | 'asset' | 'document', id: string) => {
    e.preventDefault();
    e.stopPropagation();
    // Get the element that triggered the context menu
    const targetElement = e.currentTarget as HTMLElement;
    openContextMenu(e.clientX, e.clientY, type, id, targetElement);
  }, [openContextMenu]);

  const { treeData, selectedKeys } = useSidebarTree(
    currentIds,
    folders,
    libraries,
    documents,
    {
      router,
      userRole,
      onContextMenu: handleContextMenu,
      onFolderAddClick: (folderId, anchor) => setFolderAddMenu({ folderId, anchor }),
      setSelectedFolderId,
      setError,
      setEditingKey,
      onSaveRename: handleSaveRename,
    },
    sidebarWidth
  );

  const handleProjectDeleteViaAPI = useCallback(
    async (projectId: string) => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          setError('You must be logged in to delete projects');
          return;
        }
        const response = await fetch(`/api/projects/${projectId}/delete`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const result = await response.json();
        if (!result.success) {
          setError(result.error || 'Failed to delete project');
          return;
        }
        queryClient.setQueryData<Project[]>(['projects'], (oldProjects) =>
          oldProjects ? oldProjects.filter((p) => p.id !== projectId) : []
        );
        if (currentIds.projectId === projectId) {
          router.push('/projects');
        }
        queryClient.invalidateQueries({ queryKey: ['projects'] });
      } catch (err: unknown) {
        console.error('[Sidebar] Error deleting project:', err);
        setError(err instanceof Error ? err.message : 'Failed to delete project');
      }
    },
    [supabase, queryClient, currentIds.projectId, router, setError]
  );

  const openMoveLibrary = useCallback((libraryId: string) => {
    if (userRole !== 'admin') return;
    const lib = libraries.find((item) => item.id === libraryId);
    if (!lib || lib.source_document_id) return;
    setMovingLibraryId(libraryId);
    setTargetFolderId(lib.folder_id ?? null);
    setUseIndependentLibrary(false);
    setMoveFolderSearch('');
    setShowMoveLibraryModal(true);
  }, [libraries, userRole]);

  const handleConfirmMoveLibrary = useCallback(async () => {
    if (!movingLibraryId) return;
    if (useIndependentLibrary) {
      const lib = libraries.find((l) => l.id === movingLibraryId);
      if (lib?.folder_id == null) return;
    }
    const finalTargetFolderId = useIndependentLibrary ? null : targetFolderId;
    if (!useIndependentLibrary && !finalTargetFolderId) {
      showErrorToast('Please select a destination folder or enable independent library.');
      return;
    }
    setIsMovingLibrary(true);
    try {
      await moveLibraryToFolder(supabase, movingLibraryId, { folderId: finalTargetFolderId });
      await invalidateLibraryData(queryClient, {
        projectId: currentIds.projectId,
        folderId: finalTargetFolderId,
        libraryId: movingLibraryId,
        refetchActiveFoldersLibraries: true,
      });
      expandFolder(finalTargetFolderId);
      showSuccessToast('Library moved successfully');
      setShowMoveLibraryModal(false);
      setMovingLibraryId(null);
      setTargetFolderId(null);
      setMoveFolderSearch('');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to move library';
      setError(msg);
      showErrorToast(msg);
    } finally {
      setIsMovingLibrary(false);
    }
  }, [movingLibraryId, targetFolderId, useIndependentLibrary, libraries, supabase, currentIds.projectId, queryClient, expandFolder]);

  const openMoveDocument = useCallback((documentId: string) => {
    if (userRole !== 'admin' && userRole !== 'editor') return;
    setMovingDocumentId(documentId);
  }, [userRole]);

  const openNewDocumentInFolder = useCallback((folderId: string) => {
    if (userRole !== 'admin' && userRole !== 'editor') return;
    setSelectedFolderId(folderId);
    openNewDocument();
  }, [openNewDocument, userRole]);

  const handleConfirmMoveDocument = useCallback(async (folderId: string | null) => {
    if (!movingDocumentId) return;
    setIsMovingDocument(true);
    try {
      await moveSidebarDocument({
        supabase,
        documentId: movingDocumentId,
        folderId,
        projectId: currentIds.projectId,
        queryClient,
        expandFolder,
      });
      showSuccessToast('Document moved successfully');
      setMovingDocumentId(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to move document';
      setError(msg);
      showErrorToast(msg);
    } finally {
      setIsMovingDocument(false);
    }
  }, [movingDocumentId, supabase, currentIds.projectId, queryClient, expandFolder]);

  const handleTreeDrop = useCallback(
    async (info: SidebarTreeDropInfo) => {
      if (userRole !== 'admin' && userRole !== 'editor') return;

      const dragKey = info.dragKey;
      if (pendingTreeDropKeysRef.current.has(dragKey)) return;
      const dropKey = info.dropKey;
      const target = resolveSidebarDrop({
        dragKey,
        dropKey,
        dropToGap: info.dropToGap,
        dragIsDerived: info.dragIsDerived,
        treeData,
      });

      if (target.kind === 'invalid') {
        showErrorToast(target.reason);
        return;
      }

      const projectId = currentIds.projectId;
      if (!projectId) return;
      const optimisticMove = createSidebarOptimisticMove({
        dragKey,
        target,
        folders,
        libraries,
        documents,
      });
      if (!optimisticMove) return;
      pendingTreeDropKeysRef.current.add(dragKey);

      if (target.kind === 'folder') {
        expandFolder(target.folderId);
      }

      try {
        await runOptimisticSidebarMutation({
          client: queryClient,
          projectId,
          move: optimisticMove,
          persist: async () => {
            if (optimisticMove.kind === 'folder') {
              await moveFolderToParent(
                supabase,
                optimisticMove.id,
                optimisticMove.after.parent_folder_id
              );
              return;
            }
            if (optimisticMove.kind === 'document') {
              await moveDocument(supabase, optimisticMove.id, {
                folderId: optimisticMove.after.folder_id,
              });
              return;
            }
            if (optimisticMove.before.source_document_id) {
              await detachLibraryFromDocument(supabase, optimisticMove.id, {
                folderId: optimisticMove.after.folder_id,
              });
            } else {
              await moveLibraryToFolder(supabase, optimisticMove.id, {
                folderId: optimisticMove.after.folder_id,
              });
            }
          },
          reconcile: async () => {
            if (optimisticMove.kind === 'folder') {
              await invalidateFolderData(queryClient, {
                projectId,
                folderId: optimisticMove.after.parent_folder_id ?? optimisticMove.id,
                refetchActiveFoldersLibraries: true,
              });
              return;
            }
            if (optimisticMove.kind === 'document') {
              await Promise.all([
                queryClient.invalidateQueries({ queryKey: queryKeys.documents(projectId) }),
                invalidateLibraryData(queryClient, {
                  projectId,
                  refetchActiveFoldersLibraries: true,
                }),
              ]);
              return;
            }
            await invalidateLibraryData(queryClient, {
              projectId,
              folderId: optimisticMove.after.folder_id,
              libraryId: optimisticMove.id,
              refetchActiveFoldersLibraries: true,
            });
          },
          onReconcileError: (refreshError) => {
            console.warn('[handleTreeDrop] cache refresh failed after move', refreshError);
          },
        });

        if (optimisticMove.kind === 'document') {
          void broadcastProjectDocumentUpdate({
            documentId: optimisticMove.id,
            projectId,
            action: 'move',
          });
        }

        if (optimisticMove.kind === 'folder') {
          showSuccessToast('Folder moved successfully');
        } else if (optimisticMove.kind === 'document') {
          showSuccessToast('Document moved successfully');
        } else if (optimisticMove.before.source_document_id) {
          showSuccessToast('Library detached from document');
        } else {
          showSuccessToast('Library moved successfully');
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed to move sidebar item';
        setError(msg);
        showErrorToast(msg);
      } finally {
        pendingTreeDropKeysRef.current.delete(dragKey);
      }
    },
    [
      userRole,
      treeData,
      folders,
      documents,
      libraries,
      supabase,
      currentIds.projectId,
      queryClient,
      expandFolder,
      setError,
    ]
  );

  const handleDocumentCreated = useCallback(async (documentId: string) => {
    closeDocumentModal();
    const createdFolderId = selectedFolderId;
    setSelectedFolderId(null);
    if (currentIds.projectId) {
      // Tell other clients a document appeared so their sidebar refreshes.
      void broadcastProjectDocumentUpdate({
        documentId,
        projectId: currentIds.projectId,
        action: 'create',
      });
      await queryClient.invalidateQueries({ queryKey: queryKeys.documents(currentIds.projectId) });
      expandFolder(createdFolderId);
      // Persist the currently open document before navigating to the new one;
      // keep the user in place if that flush fails.
      const flushed = await flushOpenDocumentEditor();
      if (!flushed) {
        Modal.error({
          title: 'Unsaved changes could not be saved',
          content:
            'The new document was created, but we could not save your current document. Please retry before switching.',
          zIndex: 11000,
        });
        return;
      }
      router.push(`/${currentIds.projectId}/doc/${documentId}`);
    }
  }, [closeDocumentModal, selectedFolderId, currentIds.projectId, queryClient, expandFolder, router]);

  const movingLibrary = useMemo(
    () => libraries.find((lib) => lib.id === movingLibraryId) ?? null,
    [libraries, movingLibraryId]
  );

  const currentProjectName = useMemo(
    () => projects.find((p) => p.id === currentIds.projectId)?.name ?? 'project',
    [projects, currentIds.projectId]
  );

  const filteredMoveFolders = useMemo(() => {
    const q = moveFolderSearch.trim();
    const normalizedQuery = normalizeSearchString(q);
    if (!normalizedQuery) return folders;
    return folders.filter((folder) =>
      normalizeSearchString(folder.name).includes(normalizedQuery)
    );
  }, [folders, moveFolderSearch]);

  const currentFolder = useMemo(
    () => folders.find((folder) => folder.id === movingLibrary?.folder_id) ?? null,
    [folders, movingLibrary?.folder_id]
  );

  const selectableMoveFolders = useMemo(
    () => filteredMoveFolders.filter((folder) => folder.id !== movingLibrary?.folder_id),
    [filteredMoveFolders, movingLibrary?.folder_id]
  );

  /** Independent = root; no-op if already at root with the switch on */
  const isMoveLibraryConfirmDisabled =
    isMovingLibrary ||
    (!useIndependentLibrary && !targetFolderId) ||
    (useIndependentLibrary && movingLibrary?.folder_id == null);

  const { handleContextMenuAction } = useSidebarContextMenuActions({
    contextMenu,
    closeContextMenu,
    router,
    openEditProject,
    openEditLibrary,
    openEditDocument,
    openDuplicateLibrary,
    openImportLibrary,
    openImportScript,
    openEditFolder,
    openEditAsset,
    supabase,
    queryClient,
    currentIds,
    libraries: allLibraries,
    setError,
    assets,
    fetchAssets,
    onProjectDeleteViaAPI: handleProjectDeleteViaAPI,
    openMoveLibrary,
    openMoveDocument,
    openNewDocumentInFolder,
    startInlineRename: (key: string) => setEditingKey(key),
    startDocumentDerivedImport: (source, exportType) => {
      void (async () => {
        try {
          const { data: { session }, error: sessionError } = await supabase.auth.getSession();
          if (sessionError || !session?.access_token) {
            throw new Error('Please sign in before exporting');
          }
          const result = await runDocumentDerivedImport({
            source,
            exportType,
            accessToken: session.access_token,
          });
          notifyDocumentDerivedLibraryCreated({
            projectId: source.projectId,
            documentId: source.documentId,
            libraryId: result.libraryId,
          });
          await invalidateLibraryData(queryClient, {
            projectId: source.projectId,
            folderId: source.folderId,
            libraryId: result.libraryId,
            refetchActiveFoldersLibraries: true,
          });
          router.push(`/${source.projectId}/${result.libraryId}`);
        } catch (err) {
          showErrorToast(err instanceof Error ? err.message : 'Import failed', 8000);
        }
      })();
    },
    userRole,
    requestDeleteConfirm: ({ title, content, onConfirm }) => {
      setDeleteConfirmState({
        open: true,
        title,
        content,
        loading: false,
        onConfirm,
      });
    },
  });

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteConfirmState.onConfirm) return;
    setDeleteConfirmState((prev) => ({ ...prev, loading: true }));
    try {
      await deleteConfirmState.onConfirm();
    } finally {
      setDeleteConfirmState({
        open: false,
        title: 'Confirm deletion',
        content: '',
        loading: false,
        onConfirm: undefined,
      });
    }
  }, [deleteConfirmState]);

  const handleProjectDelete = async (projectId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const confirmed = await confirmDeletion('Delete this project? All libraries under it will be removed.');
    if (!confirmed) return;
    handleProjectDeleteViaAPI(projectId);
  };

  const handleProjectCreated = async (projectId: string, defaultFolderId: string) => {
    closeProjectModal();

    // Immediately invalidate React Query cache to refresh the sidebar.
    // Mirror projects/page.tsx handleCreated: invalidate both the list and the
    // per-project key so the two creation entry points stay consistent.
    queryClient.invalidateQueries({ queryKey: ['projects'] });
    queryClient.invalidateQueries({ queryKey: ['project', projectId] });
    await invalidateProjectData(queryClient, {
      projectId,
      userProjectList: true,
      refetchActiveProjects: true,
    });

    // Always navigate to the newly created project's Recent page
    if (projectId) {
      router.push(`/${projectId}/recent`);
      // React Query will automatically fetch folders and libraries when currentIds.projectId changes
      // No need to manually call fetchFoldersAndLibraries
    }
  };

  const handleLibraryCreated = async (libraryId: string) => {
    closeLibraryModal();
    const createdFolderId = selectedFolderId;
    setSelectedFolderId(null); // Clear selection after creation

    await invalidateLibraryData(queryClient, {
      projectId: currentIds.projectId,
      folderId: createdFolderId,
      libraryId,
      refetchActiveFoldersLibraries: true,
    });
    expandFolder(createdFolderId);

    // Always navigate to the newly created library if we have a projectId
    if (currentIds.projectId) {
      router.push(`/${currentIds.projectId}/${libraryId}`);
    }
  };

  const handleFolderCreated = async (folderId: string) => {
    closeFolderModal();
    setSelectedFolderId(null); // Clear selection after creation

    await invalidateFolderData(queryClient, {
      projectId: currentIds.projectId,
      folderId,
      refetchActiveFoldersLibraries: true,
    });
    expandFolder(folderId);

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

  const handleCreateTable = () => {
    setShowAddMenu(false);
    if (!currentIds.projectId) {
      setError('Please select a project first');
      return;
    }
    // selectedFolderId is already set when button is clicked
    setSelectedFolderId(null);
    openNewLibrary();
  };

  const handleImportTable = () => {
    setShowAddMenu(false);
    if (!currentIds.projectId) {
      setError('Please select a project first');
      return;
    }
    setSelectedFolderId(null);
    openImportLibrary(null);
  };

  const handleCreateDocument = () => {
    setShowAddMenu(false);
    if (!currentIds.projectId) {
      setError('Please select a project first');
      return;
    }
    // New documents created from the top add button land at the project root.
    setSelectedFolderId(null);
    openNewDocument();
  };

  const handleImportDocument = () => {
    setShowAddMenu(false);
    if (!currentIds.projectId) {
      setError('Please select a project first');
      return;
    }
    setSelectedFolderId(null);
    setShowImportDocumentModal(true);
  };

  // TopBar Create menu reuses the same create/import flows as Libraries "+"
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const matchesProject = (detail?: { projectId?: string }) =>
      Boolean(detail?.projectId && detail.projectId === currentIds.projectId);

    const handleToolbarCreateFolder = (event: Event) => {
      const custom = event as CustomEvent<{ projectId?: string; folderId?: string | null }>;
      if (!matchesProject(custom.detail) || userRole !== 'admin') return;
      setSelectedFolderId(custom.detail?.folderId ?? null);
      openNewFolder();
    };

    const handleToolbarCreateLibrary = (event: Event) => {
      const custom = event as CustomEvent<{ projectId?: string; folderId?: string | null }>;
      if (!matchesProject(custom.detail) || userRole !== 'admin') return;
      setSelectedFolderId(custom.detail?.folderId ?? null);
      openNewLibrary();
    };

    const handleToolbarCreateDocument = (event: Event) => {
      const custom = event as CustomEvent<{ projectId?: string; folderId?: string | null }>;
      if (!matchesProject(custom.detail)) return;
      if (userRole !== 'admin' && userRole !== 'editor') return;
      setSelectedFolderId(custom.detail?.folderId ?? null);
      openNewDocument();
    };

    const handleToolbarImportTable = (event: Event) => {
      const custom = event as CustomEvent<{ projectId?: string; folderId?: string | null }>;
      if (!matchesProject(custom.detail) || userRole !== 'admin') return;
      const folderId = custom.detail?.folderId ?? null;
      setSelectedFolderId(folderId);
      openImportLibrary(folderId);
    };

    const handleToolbarImportDocument = (event: Event) => {
      const custom = event as CustomEvent<{ projectId?: string; folderId?: string | null }>;
      if (!matchesProject(custom.detail)) return;
      if (userRole !== 'admin' && userRole !== 'editor') return;
      setSelectedFolderId(custom.detail?.folderId ?? null);
      setShowImportDocumentModal(true);
    };

    window.addEventListener('library-toolbar-create-folder', handleToolbarCreateFolder);
    window.addEventListener('library-toolbar-create-library', handleToolbarCreateLibrary);
    window.addEventListener('library-toolbar-create-document', handleToolbarCreateDocument);
    window.addEventListener('library-toolbar-import-table', handleToolbarImportTable);
    window.addEventListener('library-toolbar-import-document', handleToolbarImportDocument);

    return () => {
      window.removeEventListener('library-toolbar-create-folder', handleToolbarCreateFolder);
      window.removeEventListener('library-toolbar-create-library', handleToolbarCreateLibrary);
      window.removeEventListener('library-toolbar-create-document', handleToolbarCreateDocument);
      window.removeEventListener('library-toolbar-import-table', handleToolbarImportTable);
      window.removeEventListener('library-toolbar-import-document', handleToolbarImportDocument);
    };
  }, [
    currentIds.projectId,
    userRole,
    openNewFolder,
    openNewLibrary,
    openNewDocument,
    openImportLibrary,
  ]);

  return (
    <aside
      className={`${styles.sidebar} ${!isSidebarVisible ? styles.sidebarHidden : ''} ${isResizing ? styles.sidebarResizing : ''}`}
      style={{ width: isSidebarVisible ? sidebarWidth : 0 }}
    >
      <div className={styles.brand}>
        <strong className={styles.brandTitle}>Keco Studio</strong>
        <p className={styles.brandSubtitle}>
          Manage and config game assets for game designers.
        </p>
      </div>

      {/* <div className={styles.searchContainer}>
        <label className={styles.searchLabel}>
          <Image
            src={searchIcon}
            alt="Search"
            width={24}
            height={24}
            className={`icon-24 ${styles.searchIcon}`}
          />
          <input
            placeholder="Search for..."
            className={styles.searchInput}
          />
        </label>
      </div> */}

      <div className={styles.content}>
        {/* Simulation: no sidebar nav; open /simulation-system directly or via bookmark */}

        <SidebarProjectsList
          projects={projects}
          loadingProjects={loadingProjects}
          currentProjectId={currentIds.projectId}
          currentLibraryId={currentIds.libraryId}
          currentFolderId={currentIds.folderId}
          userRole={userRole}
          onOpenNewProject={openNewProject}
          onProjectClick={handleProjectClick}
          onSaveRename={handleSaveRename}
          onContextMenu={handleContextMenu}
        />

        <SidebarProjectQuickNav projectId={currentIds.projectId} />

        {/* Show the libraries section for whatever project the user is viewing.
            Gate ONLY on currentIds.projectId — its folders/libraries come from
            useSidebarFoldersLibraries(currentIds.projectId), independent of the
            projects-list cache. Requiring projects.some(...) here would hide the
            section whenever that list is stale, still refetching, or failed
            (e.g. a collaborator opening their first project). */}
        {currentIds.projectId && (
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
              editingKey={editingKey}
              setEditingKey={setEditingKey}
              onSaveRename={handleSaveRename}
              setSelectedFolderId={setSelectedFolderId}
              onFolderAddClick={(folderId, anchor) => setFolderAddMenu({ folderId, anchor })}
              setError={setError}
              onSelect={onSelect}
              onExpand={onExpand}
              onBackToLibrary={() => {
                if (currentIds.projectId && currentIds.libraryId) {
                  router.push(`/${currentIds.projectId}/${currentIds.libraryId}`);
                }
              }}
              onAddNewAsset={() => {
                if (currentIds.projectId && currentIds.libraryId) {
                  router.push(`/${currentIds.projectId}/${currentIds.libraryId}`);
                }
              }}
              onAssetClick={handleAssetClick}
              onContextMenu={handleContextMenu}
              addButtonRef={setAddButtonRef}
              onAddButtonClick={handleAddButtonClick}
              onTreeRightClick={handleTreeRightClick}
              onTreeDrop={handleTreeDrop}
              isDragPending={isTreeDragPending}
              onDropToRoot={(dragKey) => {
                const lib = dragKey.startsWith('library-')
                  ? libraries.find((item) => item.id === dragKey.slice('library-'.length))
                  : undefined;
                void handleTreeDrop({
                  dragKey,
                  dropKey: 'libraries-root',
                  dropToGap: true,
                  dragIsDerived: Boolean(lib?.source_document_id),
                });
              }}
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
            void invalidateProjectData(queryClient, {
              projectId: editingProjectId,
              userProjectList: true,
              refetchActiveProjects: true,
            });
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
            const library = libraries.find((lib) => lib.id === editingLibraryId);
            void invalidateLibraryData(queryClient, {
              projectId: currentIds.projectId,
              folderId: library?.folder_id ?? null,
              libraryId: editingLibraryId,
              refetchActiveFoldersLibraries: true,
            });
          }}
        />
      )}

      {duplicatingLibraryId && (
        <DuplicateLibraryModal
          open={showDuplicateLibraryModal}
          libraryId={duplicatingLibraryId}
          onClose={closeDuplicateLibraryModal}
          onDuplicated={(newLibraryId) => {
            const originalLibrary = libraries.find(lib => lib.id === duplicatingLibraryId);
            const folderId = originalLibrary?.folder_id || null;

            void invalidateLibraryData(queryClient, {
              projectId: currentIds.projectId,
              folderId,
              libraryId: newLibraryId,
              refetchActiveFoldersLibraries: true,
            });
            expandFolder(folderId);

            // Navigate to the newly duplicated library
            if (currentIds.projectId) {
              router.push(`/${currentIds.projectId}/${newLibraryId}`);
            }
            showSuccessToast('Library duplicated successfully');
          }}
        />
      )}

      {showImportLibraryModal && currentIds.projectId && (
        <ImportLibraryModal
          open={showImportLibraryModal}
          projectId={currentIds.projectId}
          folderId={importingFolderId}
          onClose={closeImportLibraryModal}
          onImported={(libraryId) => {
            void invalidateLibraryData(queryClient, {
              projectId: currentIds.projectId,
              folderId: importingFolderId,
              libraryId,
              refetchActiveFoldersLibraries: true,
            });
            expandFolder(importingFolderId);
            if (currentIds.projectId) {
              router.push(`/${currentIds.projectId}/${libraryId}`);
            }
          }}
        />
      )}

      {importingScriptFolderId && currentIds.projectId && (
        <ImportScriptModal
          open={showImportScriptModal}
          projectId={currentIds.projectId}
          folderId={importingScriptFolderId}
          onClose={closeImportScriptModal}
          onImported={(libraryId) => {
            void invalidateLibraryData(queryClient, {
              projectId: currentIds.projectId,
              folderId: importingScriptFolderId,
              libraryId,
              refetchActiveFoldersLibraries: true,
            });
            expandFolder(importingScriptFolderId);
            if (currentIds.projectId) {
              router.push(`/${currentIds.projectId}/${libraryId}`);
            }
          }}
        />
      )}

      <NewFolderModal
        open={showFolderModal}
        onClose={closeFolderModal}
        projectId={currentIds.projectId || ''}
        onCreated={handleFolderCreated}
      />

      <NewDocumentModal
        open={showDocumentModal}
        onClose={closeDocumentModal}
        projectId={currentIds.projectId || ''}
        folderId={selectedFolderId}
        onCreated={handleDocumentCreated}
      />

      {editingDocumentId && (
        <EditDocumentModal
          open={showEditDocumentModal}
          documentId={editingDocumentId}
          onClose={closeEditDocumentModal}
          onUpdated={() => {
            if (currentIds.projectId) {
              void queryClient.invalidateQueries({
                queryKey: queryKeys.documents(currentIds.projectId),
              });
              void queryClient.invalidateQueries({
                queryKey: queryKeys.document(editingDocumentId),
              });
            }
          }}
        />
      )}

      <ImportDocumentModal
        open={showImportDocumentModal}
        onClose={() => setShowImportDocumentModal(false)}
        projectId={currentIds.projectId || ''}
        folderId={selectedFolderId}
        onImported={handleDocumentCreated}
      />

      <MoveDocumentModal
        key={movingDocumentId ?? 'none'}
        open={!!movingDocumentId}
        folders={folders}
        currentFolderId={documents.find((d) => d.id === movingDocumentId)?.folder_id ?? null}
        submitting={isMovingDocument}
        onClose={() => {
          if (isMovingDocument) return;
          setMovingDocumentId(null);
        }}
        onConfirm={handleConfirmMoveDocument}
      />

      {editingFolderId && (
        <EditFolderModal
          open={showEditFolderModal}
          folderId={editingFolderId}
          onClose={closeEditFolderModal}
          onUpdated={() => {
            void invalidateFolderData(queryClient, {
              projectId: currentIds.projectId,
              folderId: editingFolderId,
              refetchActiveFoldersLibraries: true,
            });
          }}
        />
      )}

      {editingAssetId && (
        <EditAssetModal
          open={showEditAssetModal}
          assetId={editingAssetId}
          onClose={closeEditAssetModal}
          onUpdated={() => {
            if (!currentIds.libraryId) return;
            void invalidateLibraryAssetsData(queryClient, {
              libraryId: currentIds.libraryId,
              assetId: editingAssetId,
              refetchActiveAssets: true,
            });
          }}
        />
      )}

      <AddLibraryMenu
        open={showAddMenu}
        anchorElement={addButtonRef}
        onClose={() => setShowAddMenu(false)}
        onCreateFolder={userRole === 'admin' ? handleCreateFolder : undefined}
        onCreateTable={userRole === 'admin' ? handleCreateTable : undefined}
        onCreateDocument={
          userRole === 'admin' || userRole === 'editor' ? handleCreateDocument : undefined
        }
        onImportDocument={
          userRole === 'admin' || userRole === 'editor' ? handleImportDocument : undefined
        }
        onImportTable={userRole === 'admin' ? handleImportTable : undefined}
      />

      <AddLibraryMenu
        open={Boolean(folderAddMenu)}
        anchorElement={folderAddMenu?.anchor ?? null}
        onClose={() => setFolderAddMenu(null)}
        onCreateTable={
          userRole === 'admin'
            ? () => {
                if (!folderAddMenu) return;
                setSelectedFolderId(folderAddMenu.folderId);
                setFolderAddMenu(null);
                openNewLibrary();
              }
            : undefined
        }
        onCreateDocument={
          userRole === 'admin' || userRole === 'editor'
            ? () => {
                if (!folderAddMenu) return;
                openNewDocumentInFolder(folderAddMenu.folderId);
                setFolderAddMenu(null);
              }
            : undefined
        }
        onImportDocument={
          userRole === 'admin' || userRole === 'editor'
            ? () => {
                if (!folderAddMenu) return;
                setSelectedFolderId(folderAddMenu.folderId);
                setFolderAddMenu(null);
                setShowImportDocumentModal(true);
              }
            : undefined
        }
        onImportTable={
          userRole === 'admin'
            ? () => {
                if (!folderAddMenu) return;
                const id = folderAddMenu.folderId;
                setFolderAddMenu(null);
                openImportLibrary(id);
              }
            : undefined
        }
        onRename={
          userRole === 'admin'
            ? () => {
                if (!folderAddMenu) return;
                setEditingKey(`folder-${folderAddMenu.folderId}`);
                setFolderAddMenu(null);
              }
            : undefined
        }
        onDuplicate={
          userRole === 'admin'
            ? () => {
                if (!folderAddMenu) return;
                const id = folderAddMenu.folderId;
                setFolderAddMenu(null);
                void duplicateFolder(supabase, id)
                  .then(async (newFolderId) => {
                    await invalidateFolderData(queryClient, {
                      projectId: currentIds.projectId,
                      folderId: newFolderId,
                      refetchActiveFoldersLibraries: true,
                    });
                    if (currentIds.projectId) {
                      await queryClient.invalidateQueries({
                        queryKey: queryKeys.documents(currentIds.projectId),
                      });
                      router.push(`/${currentIds.projectId}/folder/${newFolderId}`);
                    }
                  })
                  .catch((err: unknown) => {
                    setError(err instanceof Error ? err.message : 'Failed to duplicate folder');
                  });
              }
            : undefined
        }
        onDelete={
          userRole === 'admin'
            ? () => {
                if (!folderAddMenu) return;
                const id = folderAddMenu.folderId;
                setFolderAddMenu(null);
                setDeleteConfirmState({
                  open: true,
                  title: 'Confirm deletion',
                  content: 'Delete this folder? All libraries and subfolders under it will be removed.',
                  loading: false,
                  onConfirm: () => {
                    const librariesInFolder = libraries.filter((lib) => lib.folder_id === id);
                    const isViewingLibraryInFolder = librariesInFolder.some(
                      (lib) => lib.id === currentIds.libraryId
                    );
                    return deleteFolder(supabase, id)
                      .then(async () => {
                        await invalidateFolderData(queryClient, {
                          projectId: currentIds.projectId,
                          folderId: id,
                          refetchActiveFoldersLibraries: true,
                        });
                        if (
                          (currentIds.folderId === id || isViewingLibraryInFolder) &&
                          currentIds.projectId
                        ) {
                          router.push(`/${currentIds.projectId}`);
                        }
                      })
                      .catch((err: unknown) => {
                        setError(err instanceof Error ? err.message : 'Failed to delete folder');
                      });
                  },
                });
              }
            : undefined
        }
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
          isDerivedLibrary={
            contextMenu.type === 'library' &&
            Boolean(libraries.find((library) => library.id === contextMenu.id)?.source_document_id)
          }
          elementRef={contextMenu.elementRef}
        />
      )}

      {showMoveLibraryModal && typeof document !== 'undefined' && createPortal(
        <div
          className={styles.moveToOverlay}
          onClick={() => {
            if (isMovingLibrary) return;
            setShowMoveLibraryModal(false);
            setMovingLibraryId(null);
            setTargetFolderId(null);
            setMoveFolderSearch('');
          }}
        >
          <div className={styles.moveToModal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.moveToHeader}>
              <div className={styles.moveToTitle}>Move library</div>
              <button
                type="button"
                className={styles.moveToClose}
                aria-label="Close"
                onClick={() => {
                  if (isMovingLibrary) return;
                  setShowMoveLibraryModal(false);
                  setMovingLibraryId(null);
                  setTargetFolderId(null);
                  setMoveFolderSearch('');
                }}
              >
                <Image src={moveToCloseIcon} alt="Close" width={18} height={18} />
              </button>
            </div>

            <div className={styles.moveToSearchWrap}>
              <Image src={moveToSearchIcon} alt="Search" width={16} height={16} className={styles.moveToSearchIcon} />
              <input
                className={styles.moveToSearchInput}
                placeholder="Search folder"
                value={moveFolderSearch}
                onChange={(e) => setMoveFolderSearch(e.target.value)}
              />
            </div>

            <div className={styles.moveToProjectText}>Folder in &quot;{currentProjectName}&quot;</div>

            <label className={styles.moveToIndependentRow}>
              <span>Use as independent library</span>
              <button
                type="button"
                role="switch"
                aria-checked={useIndependentLibrary}
                className={`${styles.moveToSwitch} ${useIndependentLibrary ? styles.moveToSwitchOn : ''}`}
                onClick={() => setUseIndependentLibrary((prev) => !prev)}
              >
                <span className={styles.moveToSwitchKnob} />
              </button>
            </label>

            <div className={styles.moveToFolderList}>
              {currentFolder && (
                <div className={`${styles.moveToFolderItem} ${styles.moveToCurrentFolderItem}`} aria-disabled="true">
                  <div className={`${styles.moveToFolderLeft} ${styles.moveToFolderLeftCurrent}`}>
                    <Image src={moveToFolderDisabledIcon} alt="" width={18} height={18} aria-hidden />
                    <span>
                      {currentFolder.name} (current folder)
                    </span>
                  </div>
                </div>
              )}
              {selectableMoveFolders.map((folder) => {
                const isSelected = targetFolderId === folder.id && !useIndependentLibrary;
                return (
                  <button
                    key={folder.id}
                    type="button"
                    disabled={useIndependentLibrary}
                    className={`${styles.moveToFolderItem} ${isSelected ? styles.moveToFolderItemSelected : ''} ${useIndependentLibrary ? styles.moveToFolderItemDisabled : ''}`}
                    onClick={() => setTargetFolderId(folder.id)}
                  >
                    <div className={styles.moveToFolderLeft}>
                      <Image
                        src={moveToFolderIcon}
                        alt=""
                        width={18}
                        height={18}
                        aria-hidden
                      />
                      <span>
                        {folder.name}
                      </span>
                    </div>
                    {isSelected && (
                      <Image src={moveToSelectIcon} alt="Selected" width={18} height={18} aria-hidden />
                    )}
                  </button>
                );
              })}
            </div>

            <div className={styles.moveToFooter}>
              <button
                type="button"
                className={styles.moveToCancel}
                onClick={() => {
                  if (isMovingLibrary) return;
                  setShowMoveLibraryModal(false);
                  setMovingLibraryId(null);
                  setTargetFolderId(null);
                  setMoveFolderSearch('');
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.moveToConfirm}
                disabled={isMoveLibraryConfirmDisabled}
                onClick={handleConfirmMoveLibrary}
              >
                {isMovingLibrary ? 'Moving...' : 'Move'}
              </button>
            </div>
          </div>
        </div>
        , document.body)}

      <DeleteConfirmDialog
        open={deleteConfirmState.open}
        title={deleteConfirmState.title}
        content={deleteConfirmState.content}
        confirmLoading={deleteConfirmState.loading}
        onConfirm={handleDeleteConfirm}
        onCancel={() =>
          setDeleteConfirmState({
            open: false,
            title: 'Confirm deletion',
            content: '',
            loading: false,
            onConfirm: undefined,
          })
        }
      />

      {isSidebarVisible && (
        <div
          role="separator"
          aria-label="Resize sidebar width"
          className={styles.resizeHandle}
          onMouseDown={handleResizeStart}
        />
      )}
    </aside>
  );
}
