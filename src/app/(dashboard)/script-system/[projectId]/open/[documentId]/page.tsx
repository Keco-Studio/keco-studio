'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/contexts/AuthContext';
import { useSupabase } from '@/lib/SupabaseContext';
import { useProjectRoleQuery } from '@/lib/hooks/useProjectRoleQuery';
import { findNewestDocumentScript } from '@/lib/services/documentDerivedLibraryService';
import { fetchDocumentExportSource } from '@/lib/documents/startDocumentExport';
import { runDocumentDerivedImport } from '@/lib/documents/runDocumentDerivedImport';
import { invalidateLibraryData } from '@/lib/queryInvalidation';
import { DocumentEditor } from '@/components/documents/DocumentEditor';
import {
  openScriptFromStudio,
  type OpenScriptRole,
} from '@/lib/script-system/openScriptFromStudio';

export default function OpenScriptPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const supabase = useSupabase();
  const { userProfile } = useAuth();
  const projectId = params.projectId as string;
  const documentId = params.documentId as string;
  const roleQuery = useProjectRoleQuery(projectId, userProfile?.id);
  const activeAttemptRef = useRef(false);

  const run = useCallback(async () => {
    const role = roleQuery.data?.role as OpenScriptRole | null | undefined;
    if (!role || activeAttemptRef.current) return;
    activeAttemptRef.current = true;

    try {
      const result = await openScriptFromStudio({
        projectId,
        documentId,
        role,
            dependencies: {
          addToWorkspace: async () => {
            const response = await fetch(`/api/script-workspace/${projectId}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ documentId }),
            });
            if (!response.ok) {
              const body = await response.json().catch(() => null) as { error?: string } | null;
              throw new Error(body?.error || 'Failed to import document into Script');
            }
            await queryClient.invalidateQueries({ queryKey: ['script-workspace', projectId] });
          },
          findNewestScript: () => findNewestDocumentScript(supabase, projectId, documentId),
          generate: async () => {
            const { data: { session }, error: sessionError } = await supabase.auth.getSession();
            if (sessionError || !session?.access_token) {
              throw new Error('Please sign in before generating a conversation');
            }
            const source = await fetchDocumentExportSource(documentId, session.access_token, 'script');
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
            return result;
          },
        },
      });

      router.replace(
        result.kind === 'script'
          ? `/script-system/${projectId}/script/${result.libraryId}`
          : `/script-system/${projectId}/doc/${documentId}`
      );
    } catch (caught) {
      console.error(
        caught instanceof Error ? caught.message : 'Failed to open script'
      );
    } finally {
      activeAttemptRef.current = false;
    }
  }, [documentId, projectId, queryClient, roleQuery.data?.role, router, supabase]);

  useEffect(() => {
    if (!roleQuery.isFetched || roleQuery.isFetching) return;
    if (!roleQuery.data?.role) {
      return;
    }
    void run();
  }, [roleQuery.data?.role, roleQuery.isFetched, roleQuery.isFetching, run]);

  return (
    <DocumentEditor
      key={documentId}
      projectId={projectId}
      documentId={documentId}
      flushLayout
    />
  );
}
