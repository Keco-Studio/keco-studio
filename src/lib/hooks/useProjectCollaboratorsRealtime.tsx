'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import { useSupabase } from '@/lib/SupabaseContext';
import { queryKeys } from '@/lib/utils/queryKeys';

export type CollaboratorChange =
  | { type: 'role-change'; collaboratorId: string; newRole: string; affectedUserId: string | null }
  | { type: 'delete'; collaboratorId: string; removedUserId: string | null };

type BroadcastCollaboratorChange = (change: CollaboratorChange) => Promise<void>;

const ProjectCollaboratorsRealtimeContext = createContext<BroadcastCollaboratorChange | null>(null);

export function useProjectCollaboratorsRealtime(projectId: string, userId?: string) {
  const supabase = useSupabase();
  const queryClient = useQueryClient();
  const channelRef = useRef<RealtimeChannel | null>(null);

  const refreshCaches = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: queryKeys.projectCollaborators(projectId),
    });
    if (userId) {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.projectRole(projectId, userId),
      });
    }
  }, [projectId, queryClient, userId]);

  useEffect(() => {
    if (!projectId || !userId) return;

    const handleBroadcast = (payload: any) => {
      const change = payload.payload as CollaboratorChange | undefined;
      refreshCaches();
      if (change?.type === 'role-change' && change.affectedUserId === userId) {
        return;
      }
      if (change?.type === 'delete' && change.removedUserId === userId) {
        window.location.href = '/projects';
      }
    };

    const channel = supabase
      .channel(`project:${projectId}:collaborators`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'project_collaborators' },
        refreshCaches
      )
      .on('broadcast', { event: 'collaborator-change' }, handleBroadcast)
      .subscribe();

    channelRef.current = channel;
    return () => {
      channelRef.current = null;
      void supabase.removeChannel(channel);
    };
  }, [projectId, refreshCaches, supabase, userId]);

  return useCallback<BroadcastCollaboratorChange>(async (change) => {
    refreshCaches();
    await channelRef.current?.send({
      type: 'broadcast',
      event: 'collaborator-change',
      payload: change,
    });
  }, [refreshCaches]);
}

export function ProjectCollaboratorsRealtimeProvider({
  broadcast,
  children,
}: {
  broadcast: BroadcastCollaboratorChange;
  children: ReactNode;
}) {
  return (
    <ProjectCollaboratorsRealtimeContext.Provider value={broadcast}>
      {children}
    </ProjectCollaboratorsRealtimeContext.Provider>
  );
}

export function useCollaboratorChangeBroadcast(): BroadcastCollaboratorChange {
  const broadcast = useContext(ProjectCollaboratorsRealtimeContext);
  return broadcast ?? (async () => {});
}
