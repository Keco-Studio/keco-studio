'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useQueries } from '@tanstack/react-query';
import type { GddMapArtifactView } from '@/lib/documents/gddMapArtifactService';
import { resolveGddMapArtifact } from '@/lib/documents/gddMapArtifactService';
import { useSupabase } from '@/lib/SupabaseContext';

type ArtifactQueryState = {
  artifact: GddMapArtifactView | null | undefined;
  isLoading: boolean;
  hasError: boolean;
};

type ContextValue = {
  register: (artifactId: string) => () => void;
  states: ReadonlyMap<string, ArtifactQueryState>;
};
const Context = createContext<ContextValue | null>(null);

export const GDD_MAP_ARTIFACT_POLL_INTERVAL_MS = 15_000;

function isPendingArtifact(artifact: GddMapArtifactView): boolean {
  return artifact.status === 'queued' || artifact.status === 'running';
}

export function gddMapArtifactPollingInterval(
  artifact: GddMapArtifactView | null | undefined,
): number | false {
  return !artifact || isPendingArtifact(artifact)
    ? GDD_MAP_ARTIFACT_POLL_INTERVAL_MS
    : false;
}

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
  const queries = useQueries({
    queries: sortedIds.map((artifactId) => ({
      queryKey: ['gdd-map-artifact', projectId, artifactId] as const,
      queryFn: () => resolveGddMapArtifact(supabase, projectId, artifactId),
      enabled: Boolean(projectId),
      staleTime: GDD_MAP_ARTIFACT_POLL_INTERVAL_MS,
      refetchOnMount: true,
      refetchOnWindowFocus: true,
      refetchInterval: (activeQuery: { state: { data: GddMapArtifactView | null | undefined } }) =>
        gddMapArtifactPollingInterval(activeQuery.state.data),
    })),
  });
  const states = useMemo(
    () => new Map(sortedIds.map((artifactId, index) => {
      const query = queries[index];
      return [artifactId, {
        artifact: query?.data,
        isLoading: query?.isPending ?? true,
        hasError: query?.isError ?? false,
      }];
    })),
    [queries, sortedIds],
  );
  const value = useMemo(() => ({ register, states }), [register, states]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useGddMapReference(artifactId: string | null) {
  const context = useContext(Context);
  if (!context) throw new Error('useGddMapReference must be used within GddMapReferenceProvider');
  const state = artifactId ? context.states.get(artifactId) : undefined;
  return {
    register: context.register,
    artifact: state?.artifact ?? undefined,
    isLoading: Boolean(artifactId) && (!state || state.isLoading),
    hasError: state?.hasError ?? false,
  };
}
