'use client';

import { useQuery } from '@tanstack/react-query';
import { useSupabase } from '@/lib/SupabaseContext';
import { useAuth } from '@/lib/contexts/AuthContext';
import { createMapService } from '../services/createMapService';

export function useMapSources(projectId: string) {
  const supabase = useSupabase();
  const { userProfile } = useAuth();
  const service = createMapService(supabase);
  const projects = useQuery({
    queryKey: ['create-map', 'projects', userProfile?.id],
    queryFn: () => service.listProjects(userProfile?.id),
    enabled: Boolean(userProfile?.id),
    staleTime: 120_000,
  });
  const documents = useQuery({
    queryKey: ['create-map', 'documents', projectId],
    queryFn: () => service.listDocuments(projectId),
    enabled: Boolean(projectId),
  });
  return {
    projects: (projects.data ?? []).map(({ id, name }) => ({ id, name })),
    documents: (documents.data ?? []).map(({ id, name }) => ({ id, name })),
    isLoading: projects.isLoading || documents.isLoading,
    error: projects.error ?? documents.error,
  };
}
