'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useSupabase } from '@/lib/SupabaseContext';
import { updateDocumentName } from '@/lib/services/documentService';
import { deleteLibrary, updateLibrary } from '@/lib/services/libraryService';
import { invalidateLibraryData } from '@/lib/queryInvalidation';
import { fetchDocumentExportSource } from '@/lib/documents/startDocumentExport';
import { runDocumentDerivedImport } from '@/lib/documents/runDocumentDerivedImport';
import { notifyDocumentDerivedImportProgress, DOCUMENT_DERIVED_IMPORT_UI_LABEL } from '@/lib/documents/documentDerivedImportProgress';
import { showErrorToast, showSuccessToast } from '@/lib/utils/toast';
import type { ScriptContextMenuAction } from './ScriptContextMenu';
import { scriptWorkspaceDocumentQueryKey } from './useScriptWorkspaceDocumentMembership';

export type ScriptSidebarTarget = {
  type: 'document' | 'script';
  id: string;
  name: string;
} | null;

type UseScriptSidebarActionsParams = {
  projectId: string;
  userRole: 'admin' | 'editor' | 'viewer' | null;
  target: ScriptSidebarTarget;
  onStartRename: (target: { type: 'document' | 'script'; id: string }) => void;
  onRefreshWorkspace: () => Promise<unknown> | unknown;
  onExpandDocument?: (documentId: string) => void;
  requestDeleteConfirm: (options: {
    title: string;
    content: string;
    onConfirm: () => Promise<void> | PromiseLike<void> | void;
  }) => void;
};

/**
 * Context-menu actions for Script sidebar tree.
 * Document Delete removes workspace reference only (not the Studio document).
 * Generate conversation reuses Studio document-derived import (exportType: 'script').
 */
export function useScriptSidebarActions({
  projectId,
  userRole,
  target,
  onStartRename,
  onRefreshWorkspace,
  onExpandDocument,
  requestDeleteConfirm,
}: UseScriptSidebarActionsParams) {
  const router = useRouter();
  const supabase = useSupabase();
  const queryClient = useQueryClient();

  const handleAction = useCallback(
    (action: ScriptContextMenuAction) => {
      if (!target) return;

      if (action === 'generate-conversation' && target.type === 'document') {
        if (userRole !== 'admin' && userRole !== 'editor') return;
        const documentId = target.id;
        const startedAt = Date.now();
        notifyDocumentDerivedImportProgress({
          projectId,
          documentId,
          exportType: 'script',
          phase: 'preparing',
          label: DOCUMENT_DERIVED_IMPORT_UI_LABEL.generating,
          startedAt,
        });
        router.push(`/script-system/${projectId}/doc/${documentId}`);
        void (async () => {
          try {
            const {
              data: { session },
              error: sessionError,
            } = await supabase.auth.getSession();
            if (sessionError || !session?.access_token) {
              throw new Error('Please sign in before exporting');
            }
            const source = await fetchDocumentExportSource(
              documentId,
              session.access_token,
              'script'
            );
            const result = await runDocumentDerivedImport({
              source,
              exportType: 'script',
              accessToken: session.access_token,
            });
            await invalidateLibraryData(queryClient, {
              projectId,
              folderId: source.folderId,
              libraryId: result.libraryId,
              refetchActiveFoldersLibraries: true,
            });
            await queryClient.invalidateQueries({
              queryKey: ['script-workspace', projectId],
            });
            await onRefreshWorkspace();
            onExpandDocument?.(documentId);
            router.push(
              `/script-system/${projectId}/script/${result.libraryId}`
            );
          } catch (err) {
            const msg =
              err instanceof Error
                ? err.message
                : 'Failed to generate conversation';
            console.info('[document-derived-import]', 'error', msg, {
              projectId,
              documentId,
            });
            notifyDocumentDerivedImportProgress({
              projectId,
              documentId,
              exportType: 'script',
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

      if (action === 'rename') {
        if (target.type === 'document') {
          if (userRole !== 'admin' && userRole !== 'editor') return;
          onStartRename({ type: 'document', id: target.id });
          return;
        }
        if (target.type === 'script') {
          if (userRole !== 'admin') return;
          onStartRename({ type: 'script', id: target.id });
        }
        return;
      }

      if (action === 'delete') {
        if (target.type === 'document') {
          if (userRole !== 'admin' && userRole !== 'editor') return;
          const documentId = target.id;
          requestDeleteConfirm({
            title: 'Confirm deletion',
            content:
              'Remove this document from the Script workspace? The Studio document will not be deleted.',
            onConfirm: async () => {
              try {
                const response = await fetch(
                  `/api/script-workspace/${projectId}/${documentId}`,
                  { method: 'DELETE' }
                );
                if (!response.ok) {
                  const body = (await response.json().catch(() => null)) as {
                    error?: string;
                  } | null;
                  throw new Error(
                    body?.error || 'Failed to remove document from workspace'
                  );
                }
                await queryClient.invalidateQueries({
                  queryKey: ['script-workspace', projectId],
                });
                await queryClient.invalidateQueries({
                  queryKey: scriptWorkspaceDocumentQueryKey(projectId, documentId),
                });
                await onRefreshWorkspace();
                showSuccessToast('Removed from Script workspace');
                if (
                  typeof window !== 'undefined' &&
                  window.location.pathname.includes(
                    `/script-system/${projectId}/doc/${documentId}`
                  )
                ) {
                  router.push(`/script-system/${projectId}`);
                }
              } catch (err) {
                showErrorToast(
                  err instanceof Error
                    ? err.message
                    : 'Failed to remove document from workspace'
                );
              }
            },
          });
          return;
        }

        if (target.type === 'script') {
          if (userRole !== 'admin') return;
          const libraryId = target.id;
          requestDeleteConfirm({
            title: 'Confirm deletion',
            content: 'Delete this script?',
            onConfirm: async () => {
              try {
                await deleteLibrary(supabase, libraryId);
                await invalidateLibraryData(queryClient, {
                  projectId,
                  libraryId,
                  refetchActiveFoldersLibraries: true,
                });
                await onRefreshWorkspace();
                showSuccessToast('Script deleted');
                if (
                  typeof window !== 'undefined' &&
                  window.location.pathname.includes(
                    `/script-system/${projectId}/script/${libraryId}`
                  )
                ) {
                  router.push(`/script-system/${projectId}`);
                }
              } catch (err) {
                showErrorToast(
                  err instanceof Error ? err.message : 'Failed to delete script'
                );
              }
            },
          });
        }
      }
    },
    [
      target,
      userRole,
      projectId,
      router,
      supabase,
      queryClient,
      onStartRename,
      onRefreshWorkspace,
      onExpandDocument,
      requestDeleteConfirm,
    ]
  );

  const commitRename = useCallback(
    async (
      renameTarget: { type: 'document' | 'script'; id: string },
      nextName: string
    ) => {
      const trimmed = nextName.trim();
      if (!trimmed) return;
      try {
        if (renameTarget.type === 'document') {
          await updateDocumentName(supabase, renameTarget.id, trimmed);
          await queryClient.invalidateQueries({
            queryKey: ['script-workspace', projectId],
          });
          await onRefreshWorkspace();
        } else {
          await updateLibrary(supabase, renameTarget.id, { name: trimmed });
          await invalidateLibraryData(queryClient, {
            projectId,
            libraryId: renameTarget.id,
            refetchActiveFoldersLibraries: true,
          });
          await onRefreshWorkspace();
        }
      } catch (err) {
        showErrorToast(
          err instanceof Error ? err.message : 'Failed to rename'
        );
        throw err;
      }
    },
    [supabase, queryClient, projectId, onRefreshWorkspace]
  );

  return { handleAction, commitRename };
}
