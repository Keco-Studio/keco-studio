'use client';

import { useQuery } from '@tanstack/react-query';
import { useSupabase } from '@/lib/SupabaseContext';
import { listProjects, Project } from '@/lib/services/projectService';

/**
 * Fetches and caches the project list for the Sidebar.
 * Uses the same queryKey as the Projects page for cache sharing.
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
