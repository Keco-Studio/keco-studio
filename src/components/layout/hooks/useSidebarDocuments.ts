'use client';

import { useQuery } from '@tanstack/react-query';
import { useSupabase } from '@/lib/SupabaseContext';
import { listDocuments, type DocumentSummary } from '@/lib/services/documentService';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidProjectId(projectId: string | null): boolean {
  return !!projectId && UUID_REGEX.test(projectId);
}

/**
 * Fetches and caches the current project's documents for the Sidebar tree.
 * Keyed as ['documents', projectId] so rename/create/delete flows can update
 * the cache optimistically and realtime broadcasts can invalidate it.
 */
export function useSidebarDocuments(currentProjectId: string | null) {
  const supabase = useSupabase();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['documents', currentProjectId],
    queryFn: async () => {
      if (!currentProjectId) return [];
      return listDocuments(supabase, currentProjectId);
    },
    enabled: isValidProjectId(currentProjectId),
    staleTime: 0,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  return {
    documents: (data ?? []) as DocumentSummary[],
    isLoading,
    refetch,
  };
}
