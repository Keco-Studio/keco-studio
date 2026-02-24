'use client';

import { useEffect } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import type { Project } from '@/lib/services/projectService';

export type UseSidebarRealtimeParams = {
  supabase: SupabaseClient;
  queryClient: QueryClient;
  userProfile: { id: string } | null | undefined;
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
  userProfile,
  currentProjectId,
  router,
  refetchUserRole,
}: UseSidebarRealtimeParams) {
  useEffect(() => {
    if (!userProfile) return;

    const projectsChannel = supabase
      .channel(`projects:user:${userProfile.id}`)
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

          const { globalRequestCache } = await import('@/lib/hooks/useRequestCache');
          const { getCurrentUserId } = await import('@/lib/services/authorizationService');

          try {
            const userId = await getCurrentUserId(supabase);
            globalRequestCache.invalidate(`projects:list:${userId}`);
            if (projectId) {
              globalRequestCache.invalidate(`project:${projectId}`);
              globalRequestCache.invalidate(`project:name:${projectId}`);
            }
          } catch (err) {
            console.warn('[Sidebar] Error invalidating project cache:', err);
          }

          await queryClient.invalidateQueries({ queryKey: ['projects'] });
          await queryClient.refetchQueries({ queryKey: ['projects'], type: 'active' });

          if (payload.eventType === 'UPDATE' && payload.new && 'id' in payload.new) {
            window.dispatchEvent(new CustomEvent('projectUpdated', { detail: { projectId: payload.new.id } }));
          } else if (payload.eventType === 'DELETE' && payload.old && 'id' in payload.old) {
            queryClient.setQueryData<Project[]>(['projects'], (old) =>
              old ? old.filter((p) => p.id !== payload.old.id) : []
            );
            window.dispatchEvent(new CustomEvent('projectDeleted', { detail: { projectId: payload.old.id } }));
            if (currentProjectId === payload.old.id) {
              router.push('/projects');
            }
          }
        }
      )
      .subscribe((status, err) => {
        if (status === 'CHANNEL_ERROR' && err) console.error('[Sidebar] Projects channel ERROR:', err);
        else if (status === 'TIMED_OUT') console.error('[Sidebar] Projects channel TIMED OUT');
      });

    return () => {
      supabase.removeChannel(projectsChannel);
    };
  }, [userProfile, supabase, queryClient, currentProjectId, router]);

  useEffect(() => {
    if (!currentProjectId || !userProfile) return;

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
          const { globalRequestCache } = await import('@/lib/hooks/useRequestCache');
          globalRequestCache.invalidate(`libraries:list:${currentProjectId}:all`);
          if (payload.new && 'id' in payload.new) {
            globalRequestCache.invalidate(`library:info:${payload.new.id}`);
            globalRequestCache.invalidate(`library:${payload.new.id}`);
          }

          await queryClient.invalidateQueries({ queryKey: ['folders-libraries', currentProjectId] });
          await queryClient.refetchQueries({
            queryKey: ['folders-libraries', currentProjectId],
            type: 'active',
          });

          if (payload.eventType === 'UPDATE' && payload.new && 'id' in payload.new) {
            window.dispatchEvent(
              new CustomEvent('libraryUpdated', { detail: { libraryId: payload.new.id, projectId: currentProjectId } })
            );
          } else if (payload.eventType === 'DELETE' && payload.old && 'id' in payload.old) {
            window.dispatchEvent(
              new CustomEvent('libraryDeleted', { detail: { libraryId: payload.old.id, projectId: currentProjectId } })
            );
          } else if (payload.eventType === 'INSERT' && payload.new && 'id' in payload.new) {
            window.dispatchEvent(
              new CustomEvent('libraryCreated', { detail: { libraryId: payload.new.id, projectId: currentProjectId } })
            );
          }
        }
      )
      .subscribe((status, err) => {
        if (status === 'CHANNEL_ERROR' && err) console.error('[Sidebar] Libraries channel ERROR:', err);
        else if (status === 'TIMED_OUT') console.error('[Sidebar] Libraries channel TIMED OUT');
      });

    return () => {
      supabase.removeChannel(librariesChannel);
    };
  }, [currentProjectId, userProfile, supabase, queryClient]);

  useEffect(() => {
    if (!currentProjectId || !userProfile) return;

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
          const { globalRequestCache } = await import('@/lib/hooks/useRequestCache');
          globalRequestCache.invalidate(`folders:list:${currentProjectId}`);
          if (payload.new && 'id' in payload.new) {
            globalRequestCache.invalidate(`folder:${payload.new.id}`);
          }

          await queryClient.invalidateQueries({ queryKey: ['folders-libraries', currentProjectId] });
          await queryClient.refetchQueries({
            queryKey: ['folders-libraries', currentProjectId],
            type: 'active',
          });

          if (payload.eventType === 'UPDATE' && payload.new && 'id' in payload.new) {
            window.dispatchEvent(
              new CustomEvent('folderUpdated', { detail: { folderId: payload.new.id, projectId: currentProjectId } })
            );
          } else if (payload.eventType === 'DELETE' && payload.old && 'id' in payload.old) {
            window.dispatchEvent(
              new CustomEvent('folderDeleted', { detail: { folderId: payload.old.id, projectId: currentProjectId } })
            );
          } else if (payload.eventType === 'INSERT' && payload.new && 'id' in payload.new) {
            window.dispatchEvent(
              new CustomEvent('folderCreated', { detail: { folderId: payload.new.id, projectId: currentProjectId } })
            );
          }
        }
      )
      .subscribe((status, err) => {
        if (status === 'CHANNEL_ERROR' && err) console.error('[Sidebar] Folders channel ERROR:', err);
        else if (status === 'TIMED_OUT') console.error('[Sidebar] Folders channel TIMED OUT');
      });

    return () => {
      supabase.removeChannel(foldersChannel);
    };
  }, [currentProjectId, userProfile, supabase, queryClient]);

  useEffect(() => {
    if (!currentProjectId || !userProfile) return;

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
              .eq('user_id', userProfile.id)
              .single();

            const { data: projectCheck } = await supabase
              .from('projects')
              .select('id, owner_id')
              .eq('id', currentProjectId)
              .single();

            const isOwner = projectCheck?.owner_id === userProfile.id;
            const hasCollaboratorAccess = !!accessCheck;
            const hasAccess = isOwner || hasCollaboratorAccess;

            if (!projectCheck) {
              queryClient.setQueryData<Project[]>(['projects'], (old) =>
                old ? old.filter((p) => p.id !== currentProjectId) : []
              );
              const { globalRequestCache } = await import('@/lib/hooks/useRequestCache');
              const { getCurrentUserId } = await import('@/lib/services/authorizationService');
              try {
                const userId = await getCurrentUserId(supabase);
                globalRequestCache.invalidate(`projects:list:${userId}`);
                globalRequestCache.invalidate(`project:${currentProjectId}`);
              } catch (err) {
                console.warn('[Sidebar] Failed to clear cache:', err);
              }
              window.dispatchEvent(new CustomEvent('projectDeleted', { detail: { projectId: currentProjectId } }));
              router.push('/projects');
            } else if (!hasAccess) {
              queryClient.setQueryData<Project[]>(['projects'], (old) =>
                old ? old.filter((p) => p.id !== currentProjectId) : []
              );
              const { globalRequestCache } = await import('@/lib/hooks/useRequestCache');
              const { getCurrentUserId } = await import('@/lib/services/authorizationService');
              try {
                const userId = await getCurrentUserId(supabase);
                globalRequestCache.invalidate(`projects:list:${userId}`);
                globalRequestCache.invalidate(`project:${currentProjectId}`);
              } catch (err) {
                console.warn('[Sidebar] Failed to clear cache:', err);
              }
              queryClient.invalidateQueries({ queryKey: ['projects'] });
              router.push('/projects');
            }
          }

          if (
            (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') &&
            payload.new &&
            'user_id' in payload.new &&
            payload.new.user_id === userProfile.id
          ) {
            refetchUserRole();
          }
        }
      )
      .subscribe((status, err) => {
        if (status === 'CHANNEL_ERROR' && err) console.error('[Sidebar] Collaborators channel ERROR:', err);
        else if (status === 'TIMED_OUT') console.error('[Sidebar] Collaborators channel TIMED OUT');
      });

    return () => {
      supabase.removeChannel(collaboratorsChannel);
    };
  }, [currentProjectId, userProfile, supabase, queryClient, router, refetchUserRole]);

  useEffect(() => {
    if (!currentProjectId || !userProfile) return;

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
          const { globalRequestCache } = await import('@/lib/hooks/useRequestCache');
          globalRequestCache.invalidate(`libraries:list:${currentProjectId}:all`);
          await queryClient.invalidateQueries({ queryKey: ['folders-libraries', currentProjectId] });
          await queryClient.refetchQueries({
            queryKey: ['folders-libraries', currentProjectId],
            type: 'active',
          });
        }
      )
      .subscribe((status, err) => {
        if (status === 'CHANNEL_ERROR' && err) console.error('[Sidebar] Predefine channel ERROR:', err);
        else if (status === 'TIMED_OUT') console.error('[Sidebar] Predefine channel TIMED OUT');
      });

    return () => {
      supabase.removeChannel(predefineChannel);
    };
  }, [currentProjectId, userProfile, supabase, queryClient]);
}
