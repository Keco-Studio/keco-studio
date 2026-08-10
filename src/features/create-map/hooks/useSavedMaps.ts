'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useAuth } from '@/lib/contexts/AuthContext';
import { useSupabase } from '@/lib/SupabaseContext';
import { createMapService } from '../services/createMapService';

export type SavedMapSwitchState = {
  isDirty: boolean;
  status: 'idle' | 'creating' | 'saved' | 'saving' | 'conflict' | 'error';
};

export function savedMapSwitchBlocked({ isDirty, status }: SavedMapSwitchState): boolean {
  return isDirty || status === 'creating' || status === 'saving' || status === 'conflict';
}

export function savedMapOpenIsCurrent(currentEpoch: number, requestEpoch: number): boolean {
  return currentEpoch === requestEpoch;
}

export function useSavedMaps() {
  const supabase = useSupabase();
  const { userProfile } = useAuth();
  const service = useMemo(() => createMapService(supabase), [supabase]);
  const query = useQuery({
    queryKey: ['create-map', 'saved-maps', 'v2', userProfile?.id],
    queryFn: () => service.listSavedMapsV2(),
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
