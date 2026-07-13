'use client';

import { useEffect } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import type { Project } from '@/lib/services/projectService';
import {
  invalidateFolderData,
  invalidateLibraryData,
  invalidateProjectData,
} from '@/lib/queryInvalidation';

export type UseSidebarRealtimeParams = {
  supabase: SupabaseClient;
  queryClient: QueryClient;
  userId: string | null | undefined;
  currentProjectId: string | null;
  router: AppRouterInstance;
  refetchUserRole: () => void | Promise<void>;
};

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
  refetchUserRole,
}: UseSidebarRealtimeParams) {
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
            if (currentProjectId === payload.old.id) {
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
  }, [userId, supabase, queryClient, currentProjectId, router]);

  useEffect(() => {
    if (!currentProjectId || !userId) return;

    const librariesChannel = supabase
      .channel(`libraries:project:${currentProjectId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'libraries',
          filter: `project_id=eq.${currentProjectId}`,
        },
        async (payload) => {
          const libraryId =
            (payload.new && 'id' in payload.new ? payload.new.id : null) ||
            (payload.old && 'id' in payload.old ? payload.old.id : null);
          const folderId =
            (payload.new && 'folder_id' in payload.new ? payload.new.folder_id : null) ||
            (payload.old && 'folder_id' in payload.old ? payload.old.folder_id : null);

          await invalidateLibraryData(queryClient, {
            projectId: currentProjectId,
            folderId: typeof folderId === 'string' ? folderId : null,
            libraryId: typeof libraryId === 'string' ? libraryId : null,
            refetchActiveFoldersLibraries: true,
          });

          if (payload.new && 'id' in payload.new) {
            await invalidateLibraryData(queryClient, { libraryId: payload.new.id });
          }
        }
      )
      .subscribe((status, err) => {
        if (status === 'CHANNEL_ERROR' && err) {
          console.error('[Sidebar] Libraries channel ERROR:', err);
        } else if (status === 'TIMED_OUT') {
          console.warn('[Sidebar] Libraries channel TIMED OUT');
        }
      });

    return () => {
      supabase.removeChannel(librariesChannel);
    };
  }, [currentProjectId, userId, supabase, queryClient]);

  useEffect(() => {
    if (!currentProjectId || !userId) return;

    const foldersChannel = supabase
      .channel(`folders:project:${currentProjectId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'folders',
          filter: `project_id=eq.${currentProjectId}`,
        },
        async (payload) => {
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
      .subscribe((status, err) => {
        if (status === 'CHANNEL_ERROR' && err) {
          console.error('[Sidebar] Folders channel ERROR:', err);
        } else if (status === 'TIMED_OUT') {
          console.warn('[Sidebar] Folders channel TIMED OUT');
        }
      });

    return () => {
      supabase.removeChannel(foldersChannel);
    };
  }, [currentProjectId, userId, supabase, queryClient]);

  useEffect(() => {
    if (!currentProjectId || !userId) return;

    const collaboratorsChannel = supabase
      .channel(`collaborators:project:${currentProjectId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'project_collaborators',
          filter: `project_id=eq.${currentProjectId}`,
        },
        async (payload) => {
          if (payload.eventType === 'DELETE') {
            const { data: accessCheck } = await supabase
              .from('project_collaborators')
              .select('id')
              .eq('project_id', currentProjectId)
              .eq('user_id', userId)
              .single();

            const { data: projectCheck } = await supabase
              .from('projects')
              .select('id, owner_id')
              .eq('id', currentProjectId)
              .single();

            const isOwner = projectCheck?.owner_id === userId;
            const hasCollaboratorAccess = !!accessCheck;
            const hasAccess = isOwner || hasCollaboratorAccess;

            if (!projectCheck) {
              queryClient.setQueryData<Project[]>(['projects'], (old) =>
                old ? old.filter((p) => p.id !== currentProjectId) : []
              );
              await invalidateProjectData(queryClient, {
                projectId: currentProjectId,
                userProjectList: true,
              });
              router.push('/projects');
            } else if (!hasAccess) {
              queryClient.setQueryData<Project[]>(['projects'], (old) =>
                old ? old.filter((p) => p.id !== currentProjectId) : []
              );
              await invalidateProjectData(queryClient, {
                projectId: currentProjectId,
                userProjectList: true,
              });
              router.push('/projects');
            }
          }

          if (
            (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') &&
            payload.new &&
            'user_id' in payload.new &&
            payload.new.user_id === userId
          ) {
            refetchUserRole();
          }
        }
      )
      .subscribe((status, err) => {
        if (status === 'CHANNEL_ERROR' && err) {
          console.error('[Sidebar] Collaborators channel ERROR:', err);
        } else if (status === 'TIMED_OUT') {
          console.warn('[Sidebar] Collaborators channel TIMED OUT');
        }
      });

    return () => {
      supabase.removeChannel(collaboratorsChannel);
    };
  }, [currentProjectId, userId, supabase, queryClient, router, refetchUserRole]);

  useEffect(() => {
    if (!currentProjectId || !userId) return;

    const predefineChannel = supabase
      .channel(`predefine:project:${currentProjectId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'predefine_properties',
        },
        async (payload) => {
          await invalidateLibraryData(queryClient, {
            projectId: currentProjectId,
            refetchActiveFoldersLibraries: true,
          });
        }
      )
      .subscribe((status, err) => {
        if (status === 'CHANNEL_ERROR' && err) {
          console.error('[Sidebar] Predefine channel ERROR:', err);
        } else if (status === 'TIMED_OUT') {
          console.warn('[Sidebar] Predefine channel TIMED OUT');
        }
      });

    return () => {
      supabase.removeChannel(predefineChannel);
    };
  }, [currentProjectId, userId, supabase, queryClient]);
}
