'use client';

import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';

export type ScriptWorkspaceDocumentRef = {
  documentId: string;
  importedAt: string;
  title?: string;
  folderId?: string | null;
};

export function useScriptWorkspaceMembership(projectId: string | null | undefined) {
  const query = useQuery({
    queryKey: ['script-workspace', projectId ?? ''],
    queryFn: async (): Promise<ScriptWorkspaceDocumentRef[]> => {
      const response = await fetch(`/api/script-workspace/${projectId}`);
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error || 'Failed to load script workspace');
      }
      const data = (await response.json()) as {
        documents?: ScriptWorkspaceDocumentRef[];
      };
      return data.documents ?? [];
    },
    enabled: Boolean(projectId),
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const documents = query.data ?? [];

  const isMember = useCallback(
    (documentId: string) =>
      documents.some((doc) => doc.documentId === documentId),
    [documents]
  );

  return {
    documents,
    isMember,
    isLoading: query.isLoading,
    isFetched: query.isFetched,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}
