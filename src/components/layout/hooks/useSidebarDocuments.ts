'use client';

import { useQuery } from '@tanstack/react-query';
import { useSupabase } from '@/lib/SupabaseContext';
import { listDocuments, type DocumentSummary } from '@/lib/services/documentService';
import { queryKeys } from '@/lib/utils/queryKeys';
import { isUuid } from '@/lib/utils/uuid';

/**
 * Fetches and caches the current project's documents for the Sidebar tree.
 * Keyed via queryKeys.documents(projectId) so rename/create/delete flows can
 * update the cache optimistically and realtime broadcasts can invalidate it.
 */
export function useSidebarDocuments(currentProjectId: string | null) {
  const supabase = useSupabase();

  const { data, isLoading, refetch } = useQuery({
    queryKey: queryKeys.documents(currentProjectId ?? ''),
    queryFn: async () => {
      if (!currentProjectId) return [];
      return listDocuments(supabase, currentProjectId);
    },
    enabled: isUuid(currentProjectId),
    staleTime: 0,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });

  return {
    documents: (data ?? []) as DocumentSummary[],
    isLoading,
    refetch,
  };
}
