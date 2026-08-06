'use client';

import { useQuery } from '@tanstack/react-query';

export const scriptWorkspaceDocumentQueryKey = (
  projectId: string,
  documentId: string
) => ['script-workspace-document', projectId, documentId] as const;

export function useScriptWorkspaceDocumentMembership(
  projectId: string | null | undefined,
  documentId: string | null | undefined
) {
  const query = useQuery({
    queryKey: scriptWorkspaceDocumentQueryKey(projectId ?? '', documentId ?? ''),
    queryFn: async () => {
      const response = await fetch(
        `/api/script-workspace/${projectId}/${documentId}`
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error || 'Failed to verify script workspace membership');
      }
      const data = (await response.json()) as { member?: unknown };
      return { member: data.member === true };
    },
    enabled: Boolean(projectId && documentId),
    staleTime: 30_000,
  });

  return {
    isMember: query.data?.member === true,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isFetched: query.isFetched,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}
