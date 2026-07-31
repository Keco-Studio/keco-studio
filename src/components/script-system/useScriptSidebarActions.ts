'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useSupabase } from '@/lib/SupabaseContext';
import { updateDocumentName } from '@/lib/services/documentService';
import { deleteLibrary, updateLibrary } from '@/lib/services/libraryService';
import { invalidateLibraryData } from '@/lib/queryInvalidation';
import { showErrorToast, showSuccessToast } from '@/lib/utils/toast';
import type { ScriptContextMenuAction } from './ScriptContextMenu';

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
};

/**
 * Context-menu actions for Script sidebar tree.
 * Document Delete removes workspace reference only (not the Studio document).
 * Generate conversation is stubbed for full pipeline in Task 7.
 */
export function useScriptSidebarActions({
  projectId,
  userRole,
  target,
  onStartRename,
  onRefreshWorkspace,
}: UseScriptSidebarActionsParams) {
  const router = useRouter();
  const supabase = useSupabase();
  const queryClient = useQueryClient();

  const handleAction = useCallback(
    (action: ScriptContextMenuAction) => {
      if (!target) return;

      if (action === 'generate-conversation' && target.type === 'document') {
        if (userRole !== 'admin') return;
        // Task 7: wire fetchDocumentExportSource + runDocumentDerivedImport(exportType: 'script')
        router.push(`/script-system/${projectId}/doc/${target.id}`);
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
          const confirmed = window.confirm(
            'Remove this document from the Script workspace? The Studio document will not be deleted.'
          );
          if (!confirmed) return;
          void (async () => {
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
          })();
          return;
        }

        if (target.type === 'script') {
          if (userRole !== 'admin') return;
          const libraryId = target.id;
          const confirmed = window.confirm('Delete this script library?');
          if (!confirmed) return;
          void (async () => {
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
          })();
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
