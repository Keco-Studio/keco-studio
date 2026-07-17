'use client';

import { useEffect, useRef } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import type { Project } from '@/lib/services/projectService';
import {
  invalidateFolderData,
  invalidateLibraryData,
  invalidateProjectData,
} from '@/lib/queryInvalidation';
import {
  DOCUMENT_UPDATED_EVENT,
  projectSidebarTopic,
  type DocumentUpdatedPayload,
} from '@/lib/documents/documentBroadcast';
import {
  notifyProjectDocumentUpdate,
  registerProjectDocumentChannel,
} from '@/lib/documents/projectDocumentChannel';
import { queryKeys } from '@/lib/utils/queryKeys';

export type UseSidebarRealtimeParams = {
  supabase: SupabaseClient;
  queryClient: QueryClient;
  userId: string | null | undefined;
  currentProjectId: string | null;
  router: AppRouterInstance;
};

type RealtimeRow = Record<string, unknown> | null;

export async function invalidateSidebarLibraryChange(
  queryClient: QueryClient,
  projectId: string,
  newRow: RealtimeRow,
  oldRow: RealtimeRow
): Promise<void> {
  const libraryId = stringField(newRow, 'id') ?? stringField(oldRow, 'id');
  const folderId = stringField(newRow, 'folder_id') ?? stringField(oldRow, 'folder_id');

  await invalidateLibraryData(queryClient, {
    projectId,
    folderId,
    libraryId,
    refetchActiveFoldersLibraries: true,
  });
}

function stringField(row: RealtimeRow, key: string): string | null {
  const value = row?.[key];
  return typeof value === 'string' ? value : null;
}

/**
 * Subscribes to Supabase Realtime for Sidebar: projects, libraries, folders,
 * project_collaborators, predefine_properties.
 */
export function useSidebarRealtime({
  supabase,
  queryClient,
  userId,
  currentProjectId,
  router,
}: UseSidebarRealtimeParams) {
  const currentProjectIdRef = useRef(currentProjectId);
  // eslint-disable-next-line react-hooks/refs -- subscription callbacks need the latest rendered project.
  currentProjectIdRef.current = currentProjectId;

  useEffect(() => {
    if (!userId) return;

    const projectsChannel = supabase
      .channel(`projects:user:${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'projects',
        },
        async (payload) => {
          const projectId =
            (payload.new && 'id' in payload.new ? payload.new.id : null) ||
            (payload.old && 'id' in payload.old ? payload.old.id : null);

          const currentProjects = queryClient.getQueryData<Project[]>(['projects']) || [];
          const isUserProject = currentProjects.some((p) => p.id === projectId);

          if (!isUserProject && payload.eventType !== 'INSERT') return;

          await invalidateProjectData(queryClient, {
            projectId,
            userProjectList: true,
            refetchActiveProjects: true,
          });

          if (payload.eventType === 'UPDATE' && payload.new && 'id' in payload.new) {
            await invalidateProjectData(queryClient, { projectId: payload.new.id });
          } else if (payload.eventType === 'DELETE' && payload.old && 'id' in payload.old) {
            queryClient.setQueryData<Project[]>(['projects'], (old) =>
              old ? old.filter((p) => p.id !== payload.old.id) : []
            );
            if (currentProjectIdRef.current === payload.old.id) {
              router.push('/projects');
            }
          }
        }
      )
      .subscribe((status, err) => {
        if (status === 'CHANNEL_ERROR' && err) {
          console.error('[Sidebar] Projects channel ERROR:', err);
        } else if (status === 'TIMED_OUT') {
          // Use warn instead of error to avoid noisy dev overlay
          console.warn('[Sidebar] Projects channel TIMED OUT');
        }
      });

    return () => {
      supabase.removeChannel(projectsChannel);
    };
  }, [userId, supabase, queryClient, router]);

  useEffect(() => {
    if (!currentProjectId || !userId) return;

    let unregisterProjectChannel = () => {};
    const projectChannel = supabase
      // Single source of truth for the topic string, shared with the broadcast
      // sender (documentBroadcast.projectSidebarTopic).
      .channel(projectSidebarTopic(currentProjectId), {
        config: { private: true },
      })
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'libraries',
          filter: `project_id=eq.${currentProjectId}`,
        },
        async (payload) => {
          await invalidateSidebarLibraryChange(
            queryClient,
            currentProjectId,
            payload.new,
            payload.old
          );
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'folders',
          filter: `project_id=eq.${currentProjectId}`,
        },
        async (payload) => {
          const projectId =
            stringField(payload.new, 'project_id') ??
            stringField(payload.old, 'project_id');
          if (projectId !== currentProjectId) return;
          const folderId =
            (payload.new && 'id' in payload.new ? payload.new.id : null) ||
            (payload.old && 'id' in payload.old ? payload.old.id : null);

          await invalidateFolderData(queryClient, {
            projectId: currentProjectId,
            folderId: typeof folderId === 'string' ? folderId : null,
            refetchActiveFoldersLibraries: true,
          });

          if (payload.new && 'id' in payload.new) {
            await invalidateFolderData(queryClient, { folderId: payload.new.id });
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'predefine_properties',
        },
        async () => {
          await invalidateLibraryData(queryClient, {
            projectId: currentProjectId,
            refetchActiveFoldersLibraries: true,
          });
        }
      )
      // Documents are broadcast-only (not in the realtime publication, GitHub
      // #208). Project-scoped sidebar changes share this channel to avoid
      // exhausting the Realtime tenant connection pool during concurrent joins.
      .on(
        'broadcast',
        { event: DOCUMENT_UPDATED_EVENT },
        (message) => {
          const payload = message.payload as DocumentUpdatedPayload | undefined;
          // Always refresh the sidebar tree (create/rename/move/delete/save).
          void queryClient.invalidateQueries({
            queryKey: queryKeys.documents(currentProjectId),
          });
          // For content saves and renames also refresh the OPEN document so a
          // remote body / renamed title does not keep showing stale values.
          if (payload?.documentId) {
            void queryClient.invalidateQueries({
              queryKey: queryKeys.document(payload.documentId),
            });
            notifyProjectDocumentUpdate(payload);
          }
        }
      )
      .subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          unregisterProjectChannel();
          unregisterProjectChannel = registerProjectDocumentChannel(
            currentProjectId,
            projectChannel
          );
        } else if (status === 'CHANNEL_ERROR' && err) {
          console.error('[Sidebar] Project channel ERROR:', err);
        } else if (status === 'TIMED_OUT') {
          console.warn('[Sidebar] Project channel TIMED OUT');
        }
      });

    return () => {
      unregisterProjectChannel();
      supabase.removeChannel(projectChannel);
    };
  }, [currentProjectId, userId, supabase, queryClient]);
}
