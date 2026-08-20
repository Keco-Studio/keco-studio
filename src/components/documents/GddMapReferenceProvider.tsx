'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { GddMapArtifactView } from '@/lib/documents/gddMapArtifactService';
import { resolveGddMapArtifacts } from '@/lib/documents/gddMapArtifactService';
import { useSupabase } from '@/lib/SupabaseContext';

type ContextValue = {
  isLoading: boolean;
  hasError: boolean;
  register: (artifactId: string) => () => void;
  artifacts: ReadonlyMap<string, GddMapArtifactView>;
};
const Context = createContext<ContextValue | null>(null);

export function GddMapReferenceProvider({ projectId, children }: { projectId: string; children: ReactNode }) {
  const supabase = useSupabase();
  const [registrations, setRegistrations] = useState<Map<string, number>>(() => new Map());
  const register = useCallback((artifactId: string) => {
    setRegistrations((current) => {
      const next = new Map(current);
      next.set(artifactId, (next.get(artifactId) ?? 0) + 1);
      return next;
    });
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      setRegistrations((current) => {
        const next = new Map(current);
        const count = next.get(artifactId) ?? 0;
        if (count <= 1) next.delete(artifactId);
        else next.set(artifactId, count - 1);
        return next;
      });
    };
  }, []);
  const sortedIds = useMemo(() => [...registrations.keys()].sort(), [registrations]);
  const query = useQuery({
    queryKey: ['gdd-map-artifacts', projectId, sortedIds],
    queryFn: () => resolveGddMapArtifacts(supabase, projectId, sortedIds),
    enabled: Boolean(projectId && sortedIds.length),
    staleTime: 15_000,
    refetchInterval: 15_000,
  });
  const value = useMemo(() => ({
    isLoading: query.isPending || query.isFetching,
    hasError: query.isError,
    register,
    artifacts: query.data ?? new Map<string, GddMapArtifactView>(),
  }), [query.data, query.isError, query.isFetching, query.isPending, register]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useGddMapReference(artifactId: string | null) {
  const context = useContext(Context);
  if (!context) throw new Error('useGddMapReference must be used within GddMapReferenceProvider');
  const artifact = artifactId ? context.artifacts.get(artifactId) : undefined;
  return { ...context, artifact };
}
