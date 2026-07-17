'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { useSupabase } from '@/lib/SupabaseContext';
import { subscribeToProjectDocumentUpdates } from '@/lib/documents/projectDocumentChannel';
import {
  resolveResourceReferences,
  type ResolvedResourceReference,
} from '@/lib/documents/resourceReferenceService';
import {
  resourceReferenceAttributes,
  resourceReferenceKey,
  type ResourceReferenceTarget,
} from '@/lib/documents/resourceReferenceTypes';
import { queryKeys } from '@/lib/utils/queryKeys';

type Registration = {
  count: number;
  target: ResourceReferenceTarget;
};

type ResourceReferenceContextValue = {
  isLoading: boolean;
  register: (target: ResourceReferenceTarget) => () => void;
  resolved: ReadonlyMap<string, ResolvedResourceReference> | undefined;
};

const ResourceReferenceContext = createContext<ResourceReferenceContextValue | null>(null);

function registrationKey(target: ResourceReferenceTarget): string {
  return JSON.stringify(resourceReferenceAttributes(target));
}

export function ResourceReferenceProvider({
  children,
  projectId,
}: {
  children: ReactNode;
  projectId: string;
}) {
  const supabase = useSupabase();
  const queryClient = useQueryClient();
  const [registrations, setRegistrations] = useState<Map<string, Registration>>(
    () => new Map()
  );
  const channelByLibraryId = useRef(new Map<string, RealtimeChannel>());
  const referencedDocumentIdsRef = useRef(new Set<string>());
  const referenceKeysRef = useRef<readonly string[]>([]);

  const register = useCallback((target: ResourceReferenceTarget) => {
    const id = registrationKey(target);
    setRegistrations((current) => {
      const next = new Map(current);
      const existing = next.get(id);
      next.set(id, { target, count: (existing?.count ?? 0) + 1 });
      return next;
    });

    let active = true;
    return () => {
      if (!active) return;
      active = false;
      setRegistrations((current) => {
        const existing = current.get(id);
        if (!existing) return current;
        const next = new Map(current);
        if (existing.count === 1) next.delete(id);
        else next.set(id, { ...existing, count: existing.count - 1 });
        return next;
      });
    };
  }, []);

  const targets = useMemo(
    () =>
      [...registrations.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([, registration]) => registration.target),
    [registrations]
  );
  const keys = useMemo(
    () => [...new Set(targets.map(resourceReferenceKey))].sort(),
    [targets]
  );
  const referencedDocumentIds = useMemo(
    () => [
      ...new Set(
        targets.flatMap((target) =>
          target.kind === 'document-block' ? [target.documentId] : []
        )
      ),
    ].sort(),
    [targets]
  );
  const referencedLibraryIds = useMemo(
    () => [
      ...new Set(
        targets.flatMap((target) =>
          target.kind === 'table-row' ? [target.libraryId] : []
        )
      ),
    ].sort(),
    [targets]
  );
  const query = useQuery({
    queryKey: queryKeys.resourceReferences(projectId, keys),
    queryFn: () => resolveResourceReferences(supabase, projectId, targets),
    enabled: targets.length > 0,
    placeholderData: keepPreviousData,
  });

  useEffect(() => {
    referencedDocumentIdsRef.current = new Set(referencedDocumentIds);
    referenceKeysRef.current = keys;
  }, [keys, referencedDocumentIds]);

  const invalidateReferences = useCallback(() => {
    const currentKeys = referenceKeysRef.current;
    if (currentKeys.length === 0) return;
    void queryClient.invalidateQueries({
      queryKey: queryKeys.resourceReferences(projectId, currentKeys),
      exact: true,
    });
  }, [projectId, queryClient]);

  useEffect(
    () =>
      subscribeToProjectDocumentUpdates((payload) => {
        if (
          payload.projectId === projectId &&
          referencedDocumentIdsRef.current.has(payload.documentId)
        ) {
          invalidateReferences();
        }
      }),
    [invalidateReferences, projectId]
  );

  useEffect(() => {
    const wantedLibraryIds = new Set(referencedLibraryIds);
    for (const [libraryId, channel] of channelByLibraryId.current) {
      if (wantedLibraryIds.has(libraryId)) continue;
      channelByLibraryId.current.delete(libraryId);
      void supabase.removeChannel(channel);
    }

    for (const libraryId of wantedLibraryIds) {
      if (channelByLibraryId.current.has(libraryId)) continue;
      const invalidate = () => invalidateReferences();
      const channel = supabase
        .channel(`library:${libraryId}:edits`)
        .on('broadcast', { event: 'cell:update' }, invalidate)
        .on('broadcast', { event: 'cells:batch-update' }, invalidate)
        .on('broadcast', { event: 'asset:delete' }, invalidate)
        .subscribe();
      channelByLibraryId.current.set(libraryId, channel);
    }
  }, [invalidateReferences, referencedLibraryIds, supabase]);

  useEffect(() => {
    const channels = channelByLibraryId.current;
    return () => {
      for (const channel of channels.values()) void supabase.removeChannel(channel);
      channels.clear();
    };
  }, [supabase]);

  const value = useMemo<ResourceReferenceContextValue>(
    () => ({
      isLoading: query.isPending || query.isFetching,
      register,
      resolved: query.data,
    }),
    [query.data, query.isFetching, query.isPending, register]
  );

  return (
    <ResourceReferenceContext.Provider value={value}>
      {children}
    </ResourceReferenceContext.Provider>
  );
}

export function useResourceReference(target: ResourceReferenceTarget | null): {
  isLoading: boolean;
  resolved: ResolvedResourceReference | undefined;
} {
  const context = useContext(ResourceReferenceContext);
  if (!context) {
    throw new Error('useResourceReference must be used within ResourceReferenceProvider');
  }
  const id = target ? registrationKey(target) : '';
  const key = target ? resourceReferenceKey(target) : '';

  useEffect(() => {
    if (!target) return;
    return context.register(target);
    // The serialized ID changes only when the fixed target attributes change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context.register, id]);

  return {
    isLoading: Boolean(target) && !context.resolved?.get(key) && context.isLoading,
    resolved: key ? context.resolved?.get(key) : undefined,
  };
}
