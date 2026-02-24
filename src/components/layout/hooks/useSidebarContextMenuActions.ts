'use client';

import { useCallback } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { ContextMenuAction } from '@/components/layout/ContextMenu';
import type { SidebarContextMenuState } from './useSidebarContextMenu';
import { deleteLibrary } from '@/lib/services/libraryService';
import { deleteFolder } from '@/lib/services/folderService';
import { queryKeys } from '@/lib/utils/queryKeys';
import type { Library } from '@/lib/services/libraryService';
import type { SidebarAssetRow } from './useSidebarAssets';

export type UseSidebarContextMenuActionsParams = {
  contextMenu: SidebarContextMenuState;
  closeContextMenu: () => void;
  router: AppRouterInstance;
  openEditProject: (id: string) => void;
  openEditLibrary: (id: string) => void;
  openEditFolder: (id: string) => void;
  openEditAsset: (id: string) => void;
  supabase: SupabaseClient;
  queryClient: QueryClient;
  currentIds: {
    projectId: string | null;
    libraryId: string | null;
    folderId: string | null;
    assetId: string | null;
  };
  libraries: Library[];
  setError: (msg: string | null) => void;
  assets: Record<string, SidebarAssetRow[]>;
  fetchAssets: (libraryId: string | null | undefined) => Promise<void>;
  onProjectDeleteViaAPI: (projectId: string) => void | Promise<void>;
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
        }
      }

      // Handle delete action
      if (action === 'delete') {
        if (contextMenu.type === 'project') {
          if (window.confirm('Delete this project? All libraries under it will be removed.')) {
            onProjectDeleteViaAPI(contextMenu.id);
          }
        } else if (contextMenu.type === 'library') {
          if (window.confirm('Delete this library?')) {
            const libraryToDelete = libraries.find((lib) => lib.id === contextMenu.id);
            const deletedFolderId = libraryToDelete?.folder_id || null;
            deleteLibrary(supabase, contextMenu.id)
              .then(() => {
                if (currentIds.projectId) {
                  queryClient.invalidateQueries({ queryKey: ['folders-libraries', currentIds.projectId] });
                }
                window.dispatchEvent(
                  new CustomEvent('libraryDeleted', {
                    detail: {
                      folderId: deletedFolderId,
                      libraryId: contextMenu.id,
                      projectId: currentIds.projectId,
                    },
                  })
                );
                if (currentIds.libraryId === contextMenu.id && currentIds.projectId) {
                  router.push(`/${currentIds.projectId}`);
                }
              })
              .catch((err: unknown) => {
                setError(err instanceof Error ? err.message : 'Failed to delete library');
              });
          }
        } else if (contextMenu.type === 'folder') {
          if (
            window.confirm('Delete this folder? All libraries and subfolders under it will be removed.')
          ) {
            const librariesInFolder = libraries.filter((lib) => lib.folder_id === contextMenu.id);
            const isViewingLibraryInFolder = librariesInFolder.some(
              (lib) => lib.id === currentIds.libraryId
            );

            deleteFolder(supabase, contextMenu.id)
              .then(() => {
                if (currentIds.projectId) {
                  queryClient.invalidateQueries({
                    queryKey: ['folders-libraries', currentIds.projectId],
                  });
                }
                window.dispatchEvent(
                  new CustomEvent('folderDeleted', {
                    detail: { folderId: contextMenu.id, projectId: currentIds.projectId },
                  })
                );
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
          }
        } else if (contextMenu.type === 'asset') {
          if (window.confirm('Delete this asset?')) {
            const libraryId = Object.keys(assets).find((libId) =>
              assets[libId].some((asset) => asset.id === contextMenu.id)
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
                    const { globalRequestCache } = await import('@/lib/hooks/useRequestCache');
                    globalRequestCache.invalidate(`assets:list:${libraryId}`);

                    await queryClient.invalidateQueries({
                      queryKey: queryKeys.libraryAssets(libraryId),
                    });
                    await queryClient.invalidateQueries({
                      queryKey: queryKeys.librarySummary(libraryId),
                    });
                    await queryClient.refetchQueries({
                      queryKey: queryKeys.libraryAssets(libraryId),
                    });
                    await queryClient.refetchQueries({
                      queryKey: queryKeys.librarySummary(libraryId),
                    });

                    await fetchAssets(libraryId);
                    window.dispatchEvent(
                      new CustomEvent('assetDeleted', { detail: { libraryId } })
                    );
                    if (
                      currentIds.assetId === contextMenu.id &&
                      currentIds.projectId
                    ) {
                      router.push(`/${currentIds.projectId}/${libraryId}`);
                    }
                  }
                });
            }
          }
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
      openEditFolder,
      openEditAsset,
      supabase,
      queryClient,
      currentIds.projectId,
      currentIds.libraryId,
      currentIds.folderId,
      currentIds.assetId,
      libraries,
      setError,
      assets,
      fetchAssets,
      onProjectDeleteViaAPI,
    ]
  );

  return { handleContextMenuAction };
}
