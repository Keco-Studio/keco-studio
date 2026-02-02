'use client';

import { useQuery } from '@tanstack/react-query';
import { useSupabase } from '@/lib/SupabaseContext';
import { listProjects, Project } from '@/lib/services/projectService';

/**
 * 项目列表请求与缓存，供 Sidebar 使用。
 * queryKey 与 Projects 页一致，便于共享缓存。
 */
export function useSidebarProjects(userId?: string | null) {
  const supabase = useSupabase();

  const {
    data: projects = [],
    isLoading: loadingProjects,
    error: projectsError,
    refetch: refetchProjects,
  } = useQuery({
    queryKey: ['projects'],
    queryFn: () => listProjects(supabase, userId ?? undefined),
    enabled: true,
    staleTime: 2 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  return {
    projects: projects as Project[],
    isLoading: loadingProjects,
    error: projectsError,
    refetch: refetchProjects,
  };
}
