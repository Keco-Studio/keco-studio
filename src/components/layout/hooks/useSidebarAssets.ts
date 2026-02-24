'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSupabase } from '@/lib/SupabaseContext';

export type SidebarAssetRow = { id: string; name: string; library_id: string };

/**
 * Fetches and caches asset list per library for the Sidebar (tree expand / asset list view).
 */
export function useSidebarAssets(currentLibraryId: string | null) {
  const supabase = useSupabase();
  const [assets, setAssets] = useState<Record<string, SidebarAssetRow[]>>({});
  const fetchingRef = useRef<Set<string>>(new Set());

  const fetchAssets = useCallback(async (libraryId: string | null | undefined) => {
    if (!libraryId) return;
    if (fetchingRef.current.has(libraryId)) return;

    fetchingRef.current.add(libraryId);
    try {
      const { globalRequestCache } = await import('@/lib/hooks/useRequestCache');
      const cacheKey = `assets:list:${libraryId}`;

      const data = await globalRequestCache.fetch(cacheKey, async () => {
        const { data: rows, error } = await supabase
          .from('library_assets')
          .select('id,name,library_id')
          .eq('library_id', libraryId)
          .order('created_at', { ascending: true });
        if (error) throw error;
        return (rows as SidebarAssetRow[]) || [];
      });

      setAssets((prev) => ({ ...prev, [libraryId]: data }));
    } catch (err) {
      console.error('Failed to load assets', err);
    } finally {
      fetchingRef.current.delete(libraryId);
    }
  }, [supabase]);

  useEffect(() => {
    if (currentLibraryId) {
      fetchAssets(currentLibraryId);
    }
  }, [currentLibraryId, fetchAssets]);

  useEffect(() => {
    const handleAssetChange = async (event: Event) => {
      const customEvent = event as CustomEvent<{ libraryId: string }>;
      if (customEvent.detail?.libraryId) {
        const { globalRequestCache } = await import('@/lib/hooks/useRequestCache');
        globalRequestCache.invalidate(`assets:list:${customEvent.detail.libraryId}`);
        fetchAssets(customEvent.detail.libraryId);
      }
    };

    window.addEventListener('assetCreated', handleAssetChange);
    window.addEventListener('assetUpdated', handleAssetChange);
    window.addEventListener('assetDeleted', handleAssetChange);

    return () => {
      window.removeEventListener('assetCreated', handleAssetChange);
      window.removeEventListener('assetUpdated', handleAssetChange);
      window.removeEventListener('assetDeleted', handleAssetChange);
    };
  }, [fetchAssets]);

  return { assets, fetchAssets };
}
