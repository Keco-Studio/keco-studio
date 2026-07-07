'use client';

import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSupabase } from '@/lib/SupabaseContext';
import { sidebarAssetsKey } from '@/lib/queryInvalidation';

export type SidebarAssetRow = { id: string; name: string; library_id: string };

export function useSidebarAssets(currentLibraryId: string | null) {
  const supabase = useSupabase();
  const queryClient = useQueryClient();

  const fetchSidebarAssets = useCallback(
    async (libraryId: string) => {
        const { data: rows, error } = await supabase
          .from('library_assets')
          .select('id,name,library_id')
          .eq('library_id', libraryId)
          .order('created_at', { ascending: true });
        if (error) throw error;
        return (rows as SidebarAssetRow[]) || [];
    },
    [supabase]
  );

  const { data: currentAssets = [] } = useQuery({
    queryKey: currentLibraryId
      ? sidebarAssetsKey(currentLibraryId)
      : ['sidebar-assets', 'none'],
    queryFn: () => fetchSidebarAssets(currentLibraryId!),
    enabled: !!currentLibraryId,
  });

  const fetchAssets = useCallback(
    async (libraryId: string | null | undefined) => {
      if (!libraryId) return;
      await queryClient.ensureQueryData({
        queryKey: sidebarAssetsKey(libraryId),
        queryFn: () => fetchSidebarAssets(libraryId),
      });
    },
    [fetchSidebarAssets, queryClient]
  );

  const assets = useMemo(
    () => (currentLibraryId ? { [currentLibraryId]: currentAssets } : {}),
    [currentAssets, currentLibraryId]
  );

  return { assets, fetchAssets };
}
