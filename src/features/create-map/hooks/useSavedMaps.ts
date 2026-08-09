'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useAuth } from '@/lib/contexts/AuthContext';
import { useSupabase } from '@/lib/SupabaseContext';
import { createMapService } from '../services/createMapService';

export function useSavedMaps() {
  const supabase = useSupabase();
  const { userProfile } = useAuth();
  const service = useMemo(() => createMapService(supabase), [supabase]);
  const query = useQuery({
    queryKey: ['create-map', 'saved-maps', userProfile?.id],
    queryFn: () => service.listSavedMaps(),
    enabled: Boolean(userProfile?.id),
    staleTime: 30_000,
  });

  return {
    maps: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}
