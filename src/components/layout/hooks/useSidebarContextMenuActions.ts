'use client';

import { useCallback, useEffect } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { ContextMenuAction } from '@/components/layout/ContextMenu';
import type { SidebarContextMenuState } from './useSidebarContextMenu';
import { deleteLibrary } from '@/lib/services/libraryService';
import { deleteFolder, duplicateFolder } from '@/lib/services/folderService';
import {
  deleteDocument,
  moveDocument,
} from '@/lib/services/documentService';
import { broadcastProjectDocumentUpdate } from '@/lib/documents/projectDocumentChannel';
import { queryKeys } from '@/lib/utils/queryKeys';
import {
  invalidateFolderData,
  invalidateLibraryAssetsData,
  invalidateLibraryData,
} from '@/lib/queryInvalidation';
import type { Library } from '@/lib/services/libraryService';
import type { SidebarAssetRow } from './useSidebarAssets';
import type { DocumentSummary } from '@/lib/services/documentService';
import {
  DOCUMENT_DERIVED_LIBRARY_CREATED_EVENT,
  type DocumentDerivedLibraryCreatedDetail,
} from '@/lib/documents/documentDerivedLibraryEvents';
import type { DocumentExportSource } from '@/lib/documents/documentExportSource';
import { fetchDocumentExportSource } from '@/lib/documents/startDocumentExport';
import { showErrorToast } from '@/lib/utils/toast';
import type { DocumentExportType } from '@/lib/services/documentDerivedLibraryService';
import { notifyDocumentDerivedImportProgress, DOCUMENT_DERIVED_IMPORT_UI_LABEL } from '@/lib/documents/documentDerivedImportProgress';
export async function moveSidebarDocument({
  supabase,
  documentId,
  folderId,
  projectId,
  queryClient,
  expandFolder,
}: {
  supabase: SupabaseClient;
  documentId: string;
  folderId: string | null;
  projectId: string | null;
  queryClient: QueryClient;
  expandFolder: (folderId: string | null | undefined) => void;
}) {
  await moveDocument(supabase, documentId, { folderId });
  if (projectId) {
    void broadcastProjectDocumentUpdate({
      documentId,
      projectId,
      action: 'move',
    });
    await queryClient.invalidateQueries({
      queryKey: queryKeys.documents(projectId),
    });
    await invalidateLibraryData(queryClient, {
      projectId,
      refetchActiveFoldersLibraries: true,
    });
  }
  expandFolder(folderId);
}

type UseSidebarDocumentDerivedLibraryLifecycleParams = {
  currentProjectId: string | null;
  documents: DocumentSummary[];
  queryClient: QueryClient;
  expandFolder: (folderId: string | null | undefined) => void;
};

export function useSidebarDocumentDerivedLibraryLifecycle({
  currentProjectId,
  documents,
  queryClient,
  expandFolder,
}: UseSidebarDocumentDerivedLibraryLifecycleParams) {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleDerivedLibraryCreated = (event: Event) => {
      const detail = (event as CustomEvent<DocumentDerivedLibraryCreatedDetail>).detail;
      if (!detail || detail.projectId !== currentProjectId) return;

      void invalidateLibraryData(queryClient, {
        projectId: currentProjectId,
        refetchActiveFoldersLibraries: true,
      });
      const sourceDocument = documents.find(
        (document) => document.id === detail.documentId
      );
      expandFolder(sourceDocument?.folder_id);
    };

    window.addEventListener(
      DOCUMENT_DERIVED_LIBRARY_CREATED_EVENT,
      handleDerivedLibraryCreated
    );
    return () =>
      window.removeEventListener(
        DOCUMENT_DERIVED_LIBRARY_CREATED_EVENT,
        handleDerivedLibraryCreated
      );
  }, [currentProjectId, documents, expandFolder, queryClient]);
}

export type UseSidebarContextMenuActionsParams = {
  contextMenu: SidebarContextMenuState;
  closeContextMenu: () => void;
  router: AppRouterInstance;
  openEditProject: (id: string) => void;
  openEditLibrary: (id: string) => void;
  openEditDocument?: (id: string) => void;
  openDuplicateLibrary: (id: string) => void;
  openImportLibrary: (folderId: string | null) => void;
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
  openNewDocumentInFolder: (folderId: string) => void;
  startInlineRename: (key: string) => void;
  /** Silent document Generate table (no ImportScriptModal). */
  startDocumentDerivedImport: (
    source: DocumentExportSource,
    exportType: DocumentExportType
  ) => void;
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
  openEditDocument,
  openDuplicateLibrary,
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
  openNewDocumentInFolder,
  startInlineRename,
  startDocumentDerivedImport,
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

      if (action === 'new-document' && contextMenu.type === 'folder') {
        if (userRole === 'admin' || userRole === 'editor') {
          openNewDocumentInFolder(contextMenu.id);
        }
        closeContextMenu();
        return;
      }

      // Handle rename action (Project info / Library info / Folder rename)
      if (action === 'rename') {
        if (contextMenu.type === 'project') {
          openEditProject(contextMenu.id);
          closeContextMenu();
          return;
        } else if (contextMenu.type === 'library') {
          // Library info opens the name/notes modal; inline rename is the Rename item.
          openEditLibrary(contextMenu.id);
          closeContextMenu();
          return;
        } else if (contextMenu.type === 'folder') {
          startInlineRename(`folder-${contextMenu.id}`);
          closeContextMenu();
          return;
        } else if (contextMenu.type === 'asset') {
          openEditAsset(contextMenu.id);
          closeContextMenu();
          return;
        } else if (contextMenu.type === 'document') {
          if (openEditDocument) {
            openEditDocument(contextMenu.id);
          } else {
            startInlineRename(`document-${contextMenu.id}`);
          }
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
        if (contextMenu.type === 'folder') {
          if (userRole !== 'admin') {
            closeContextMenu();
            return;
          }
          const sourceFolderId = contextMenu.id;
          closeContextMenu();
          void duplicateFolder(supabase, sourceFolderId)
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
          return;
        }
        closeContextMenu();
        return;
      }

      if (action === 'move-to') {
        if (contextMenu.type === 'library') {
          if (userRole !== 'admin') {
            closeContextMenu();
            return;
          }
          const library = libraries.find((item) => item.id === contextMenu.id);
          if (library?.source_document_id) {
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


      if (action === 'generate-table' && contextMenu.type === 'document') {
        if (userRole !== 'admin' || !currentIds.projectId) {
          closeContextMenu();
          return;
        }
        const documentId = contextMenu.id;
        const projectId = currentIds.projectId;
        closeContextMenu();
        const startedAt = Date.now();
        notifyDocumentDerivedImportProgress({
          projectId,
          documentId,
          exportType: 'table',
          phase: 'preparing',
          label: DOCUMENT_DERIVED_IMPORT_UI_LABEL.generating,
          startedAt,
        });
        router.push(`/${projectId}/doc/${documentId}`);
        void (async () => {
          try {
            const { data: { session }, error: sessionError } = await supabase.auth.getSession();
            if (sessionError || !session?.access_token) {
              throw new Error('Please sign in before exporting');
            }
            // Shared import_script / Story IR pipeline; Studio nests the result as a table.
            const source = await fetchDocumentExportSource(documentId, session.access_token);
            startDocumentDerivedImport(source, 'table');
          } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to generate table';
            setError(msg);
            console.info('[document-derived-import]', 'error', msg, {
              projectId,
              documentId,
            });
            notifyDocumentDerivedImportProgress({
              projectId,
              documentId,
              exportType: 'table',
              phase: 'error',
              label: DOCUMENT_DERIVED_IMPORT_UI_LABEL.failed,
              error: msg,
              startedAt,
            });
            showErrorToast(msg, 8000);
          }
        })();
        return;
      }

      if (action === 'version-history') {
        if (contextMenu.type === 'library') {
          const projectId = currentIds.projectId;
          const libraryId = contextMenu.id;
          closeContextMenu();
          if (!projectId) return;

          const openVersionControl = () => {
            window.dispatchEvent(
              new CustomEvent('library-version-control-toggle', {
                detail: {
                  projectId,
                  libraryId,
                  open: true,
                },
              })
            );
          };

          if (currentIds.libraryId === libraryId) {
            openVersionControl();
            return;
          }

          try {
            window.sessionStorage.setItem(
              'keco-open-library-version-control',
              JSON.stringify({ projectId, libraryId })
            );
          } catch {
            // Ignore sessionStorage failures; still navigate to the library.
          }
          router.push(`/${projectId}/${libraryId}`);
          return;
        }

        if (contextMenu.type === 'document') {
          const projectId = currentIds.projectId;
          const documentId = contextMenu.id;
          closeContextMenu();
          if (!projectId) return;

          if (currentIds.documentId === documentId) {
            window.dispatchEvent(new CustomEvent('document-history-toggle'));
            return;
          }

          try {
            window.sessionStorage.setItem('keco-open-document-history', documentId);
          } catch {
            // Ignore sessionStorage failures; still navigate to the document.
          }
          router.push(`/${projectId}/doc/${documentId}`);
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
          const derivedLibraries = libraries.filter(
            (library) => library.source_document_id === contextMenu.id
          );
          const tableCount = derivedLibraries.filter(
            (library) => library.document_export_type === 'table'
          ).length;
          const scriptCount = derivedLibraries.filter(
            (library) => library.document_export_type === 'script'
          ).length;
          const cascadeParts = [
            tableCount ? `${tableCount} table${tableCount === 1 ? '' : 's'}` : '',
            scriptCount ? `${scriptCount} script${scriptCount === 1 ? '' : 's'}` : '',
          ].filter(Boolean);
          const cascadeCopy = cascadeParts.length
            ? ` ${cascadeParts.join(' and ')} will also be deleted.`
            : '';
          requestDeleteConfirm({
            title: 'Confirm deletion',
            content: `Delete this document permanently?${cascadeCopy}`,
            onConfirm: () => {
              const documentId = contextMenu.id;
              return deleteDocument(supabase, documentId)
                .then(async () => {
                  if (currentIds.projectId) {
                    void broadcastProjectDocumentUpdate({
                      documentId,
                      projectId: currentIds.projectId,
                      action: 'delete',
                    });
                    await queryClient.invalidateQueries({
                      queryKey: queryKeys.documents(currentIds.projectId),
                    });
                    await invalidateLibraryData(queryClient, {
                      projectId: currentIds.projectId,
                      refetchActiveFoldersLibraries: true,
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
      openEditDocument,
      openDuplicateLibrary,
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
      openNewDocumentInFolder,
      startInlineRename,
      startDocumentDerivedImport,
      userRole,
      requestDeleteConfirm,
    ]
  );

  return { handleContextMenuAction };
}
