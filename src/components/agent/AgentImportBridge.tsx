'use client';

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@/lib/contexts/NavigationContext';
import { ImportScriptModal } from '@/components/libraries/ImportScriptModal';
import { invalidateLibraryData } from '@/lib/queryInvalidation';

interface PendingImport {
  folderId: string;
  libraryName: string;
  fullText: string;
}

/**
 * Bridges the agent "Edit in Import Modal" handoff: listens for
 * agent:open-import-modal, opens the existing ImportScriptModal pre-filled, and
 * re-emits agent:import-complete after a successful import.
 */
export function AgentImportBridge() {
  const { currentProjectId } = useNavigation();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<PendingImport | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as PendingImport | undefined;
      if (detail && detail.folderId && typeof detail.fullText === 'string') {
        setPending(detail);
      }
    };
    window.addEventListener('agent:open-import-modal', handler);
    return () => window.removeEventListener('agent:open-import-modal', handler);
  }, []);

  if (!pending || !currentProjectId) return null;
  const projectId = currentProjectId;

  return (
    <ImportScriptModal
      open
      projectId={projectId}
      folderId={pending.folderId}
      initialText={pending.fullText}
      initialLibraryName={pending.libraryName}
      onClose={() => setPending(null)}
      onImported={(libraryId) => {
        window.dispatchEvent(
          new CustomEvent('agent:import-complete', {
            detail: { libraryId, libraryName: pending.libraryName },
          })
        );
        void invalidateLibraryData(queryClient, {
          projectId,
          folderId: pending.folderId,
          libraryId,
          refetchActiveFoldersLibraries: true,
        });
        setPending(null);
      }}
    />
  );
}

export default AgentImportBridge;
