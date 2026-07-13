'use client';

import { useCallback } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { ContextMenuAction } from '@/components/layout/ContextMenu';
import type { SidebarContextMenuState } from './useSidebarContextMenu';
import { deleteLibrary } from '@/lib/services/libraryService';
import { deleteFolder } from '@/lib/services/folderService';
import { deleteDocument } from '@/lib/services/documentService';
import { broadcastDocumentUpdated } from '@/lib/documents/documentBroadcast';
import { queryKeys } from '@/lib/utils/queryKeys';
import {
  invalidateFolderData,
  invalidateLibraryAssetsData,
  invalidateLibraryData,
} from '@/lib/queryInvalidation';
import type { Library } from '@/lib/services/libraryService';
import type { SidebarAssetRow } from './useSidebarAssets';

export type UseSidebarContextMenuActionsParams = {
  contextMenu: SidebarContextMenuState;
  closeContextMenu: () => void;
  router: AppRouterInstance;
  openEditProject: (id: string) => void;
  openEditLibrary: (id: string) => void;
  openDuplicateLibrary: (id: string) => void;
  openExportLibrary: (id: string) => void;
  openImportLibrary: (folderId: string) => void;
  openImportScript: (folderId: string) => void;
  openEditFolder: (id: string) => void;
  openEditAsset: (id: string) => void;
  supabase: SupabaseClient;
  queryClient: QueryClient;
  currentIds: {
    projectId: string | null;
    libraryId: string | null;
    folderId: string | null;
    assetId: string | null;
    documentId: string | null;
  };
  libraries: Library[];
  setError: (msg: string | null) => void;
  assets: Record<string, SidebarAssetRow[]>;
  fetchAssets: (libraryId: string | null | undefined) => Promise<void>;
  onProjectDeleteViaAPI: (projectId: string) => void | Promise<void>;
  openMoveLibrary: (libraryId: string) => void;
  openMoveDocument: (documentId: string) => void;
  startInlineRename: (key: string) => void;
  userRole: 'admin' | 'editor' | 'viewer' | null;
  requestDeleteConfirm: (options: {
    title: string;
    content: string;
    onConfirm: () => Promise<void> | PromiseLike<void> | void;
  }) => void;
};

/**
 * Returns the handler for context menu actions (rename, delete, collaborators).
 * Keeps Sidebar free of the large switch/if-else block.
 */
export function useSidebarContextMenuActions({
  contextMenu,
  closeContextMenu,
  router,
  openEditProject,
  openEditLibrary,
  openDuplicateLibrary,
  openExportLibrary,
  openImportLibrary,
  openImportScript,
  openEditFolder,
  openEditAsset,
  supabase,
  queryClient,
  currentIds,
  libraries,
  setError,
  assets,
  fetchAssets,
  onProjectDeleteViaAPI,
  openMoveLibrary,
  openMoveDocument,
  startInlineRename,
  userRole,
  requestDeleteConfirm,
}: UseSidebarContextMenuActionsParams) {
  const handleContextMenuAction = useCallback(
    (action: ContextMenuAction) => {
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
        } else if (contextMenu.type === 'document') {
          startInlineRename(`document-${contextMenu.id}`);
          closeContextMenu();
          return;
        }
      }

      // Handle duplicate action
      if (action === 'duplicate') {
        if (contextMenu.type === 'library') {
          openDuplicateLibrary(contextMenu.id);
          closeContextMenu();
          return;
        }
        // Project, Folder, Asset duplication not implemented yet
        closeContextMenu();
        return;
      }

      if (action === 'move-to') {
        if (contextMenu.type === 'library') {
          if (userRole !== 'admin') {
            closeContextMenu();
            return;
          }
          openMoveLibrary(contextMenu.id);
          closeContextMenu();
          return;
        }
        if (contextMenu.type === 'document') {
          if (userRole !== 'admin' && userRole !== 'editor') {
            closeContextMenu();
            return;
          }
          openMoveDocument(contextMenu.id);
          closeContextMenu();
          return;
        }
        closeContextMenu();
        return;
      }

      // Handle export action (library: open export modal)
      if (action === 'export') {
        if (contextMenu.type === 'library') {
          openExportLibrary(contextMenu.id);
          closeContextMenu();
          return;
        }
        closeContextMenu();
        return;
      }

      // Handle import action (folder: open library import modal)
      if (action === 'import') {
        if (contextMenu.type === 'folder') {
          openImportLibrary(contextMenu.id);
          closeContextMenu();
          return;
        }
        closeContextMenu();
        return;
      }

      // Handle import script action (folder: open script import modal)
      if (action === 'import-script') {
        if (contextMenu.type === 'folder') {
          openImportScript(contextMenu.id);
          closeContextMenu();
          return;
        }
        closeContextMenu();
        return;
      }

      // Handle delete action
      if (action === 'delete') {
        if (contextMenu.type === 'project') {
          requestDeleteConfirm({
            title: 'Confirm deletion',
            content: 'Delete this project? All libraries under it will be removed.',
            onConfirm: () => onProjectDeleteViaAPI(contextMenu.id),
          });
          closeContextMenu();
          return;
        } else if (contextMenu.type === 'library') {
          requestDeleteConfirm({
            title: 'Confirm deletion',
            content: 'Delete this library?',
            onConfirm: () => {
              const libraryToDelete = libraries.find((lib) => lib.id === contextMenu.id);
              const deletedFolderId = libraryToDelete?.folder_id || null;
              return deleteLibrary(supabase, contextMenu.id)
                .then(async () => {
                  await invalidateLibraryData(queryClient, {
                    projectId: currentIds.projectId,
                    folderId: deletedFolderId,
                    libraryId: contextMenu.id,
                    refetchActiveFoldersLibraries: true,
                  });
                  if (currentIds.libraryId === contextMenu.id && currentIds.projectId) {
                    router.push(`/${currentIds.projectId}`);
                  }
                })
                .catch((err: unknown) => {
                  setError(err instanceof Error ? err.message : 'Failed to delete library');
                });
            },
          });
          closeContextMenu();
          return;
        } else if (contextMenu.type === 'folder') {
          requestDeleteConfirm({
            title: 'Confirm deletion',
            content: 'Delete this folder? All libraries and subfolders under it will be removed.',
            onConfirm: () => {
              const librariesInFolder = libraries.filter((lib) => lib.folder_id === contextMenu.id);
              const isViewingLibraryInFolder = librariesInFolder.some(
                (lib) => lib.id === currentIds.libraryId
              );

              return deleteFolder(supabase, contextMenu.id)
                .then(async () => {
                  await invalidateFolderData(queryClient, {
                    projectId: currentIds.projectId,
                    folderId: contextMenu.id,
                    refetchActiveFoldersLibraries: true,
                  });
                  if (
                    (currentIds.folderId === contextMenu.id || isViewingLibraryInFolder) &&
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
          closeContextMenu();
          return;
        } else if (contextMenu.type === 'document') {
          requestDeleteConfirm({
            title: 'Confirm deletion',
            content: 'Delete this document?',
            onConfirm: () => {
              const documentId = contextMenu.id;
              return deleteDocument(supabase, documentId)
                .then(async () => {
                  if (currentIds.projectId) {
                    void broadcastDocumentUpdated(supabase, {
                      documentId,
                      projectId: currentIds.projectId,
                      action: 'delete',
                    });
                    await queryClient.invalidateQueries({
                      queryKey: queryKeys.documents(currentIds.projectId),
                    });
                  }
                  if (currentIds.documentId === documentId && currentIds.projectId) {
                    router.push(`/${currentIds.projectId}`);
                  }
                })
                .catch((err: unknown) => {
                  setError(err instanceof Error ? err.message : 'Failed to delete document');
                });
            },
          });
          closeContextMenu();
          return;
        } else if (contextMenu.type === 'asset') {
          requestDeleteConfirm({
            title: 'Confirm deletion',
            content: 'Delete this asset?',
            onConfirm: () => {
              const libraryId = Object.keys(assets).find((libId) =>
                assets[libId].some((asset) => asset.id === contextMenu.id)
              );
              if (!libraryId) return;
              return supabase
                .from('library_assets')
                .delete()
                .eq('id', contextMenu.id)
                .then(async (result) => {
                  if (result.error) {
                    console.error('Failed to delete asset', result.error);
                  } else {
                    await invalidateLibraryAssetsData(queryClient, {
                      libraryId,
                      assetId: contextMenu.id,
                      refetchActiveAssets: true,
                    });

                    await fetchAssets(libraryId);
                    if (
                      currentIds.assetId === contextMenu.id &&
                      currentIds.projectId
                    ) {
                      router.push(`/${currentIds.projectId}/${libraryId}`);
                    }
                  }
                });
            },
          });
          closeContextMenu();
          return;
        }
      }

      closeContextMenu();
    },
    [
      contextMenu,
      closeContextMenu,
      router,
      openEditProject,
      openEditLibrary,
      openDuplicateLibrary,
      openExportLibrary,
      openImportLibrary,
      openImportScript,
      openEditFolder,
      openEditAsset,
      supabase,
      queryClient,
      currentIds.projectId,
      currentIds.libraryId,
      currentIds.folderId,
      currentIds.assetId,
      currentIds.documentId,
      libraries,
      setError,
      assets,
      fetchAssets,
      onProjectDeleteViaAPI,
      openMoveLibrary,
      openMoveDocument,
      startInlineRename,
      userRole,
      requestDeleteConfirm,
    ]
  );

  return { handleContextMenuAction };
}
