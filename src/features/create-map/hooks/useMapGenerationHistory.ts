'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useSupabase } from '@/lib/SupabaseContext';
import { createMapService } from '../services/createMapService';

export function useMapGenerationHistory(mapId: string | null) {
  const supabase = useSupabase();
  const service = useMemo(() => createMapService(supabase), [supabase]);
  const query = useQuery({
    queryKey: ['create-map', 'generation-history', 'v3', mapId],
    queryFn: () => service.listGenerationHistoryV3(mapId as string),
    enabled: Boolean(mapId),
    staleTime: 30_000,
  });

  return {
    revisions: query.data ?? [],
    refetch: query.refetch,
  };
}
