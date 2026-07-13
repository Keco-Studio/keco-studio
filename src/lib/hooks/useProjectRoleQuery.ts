'use client';

import { useQuery } from '@tanstack/react-query';
import { useSupabase } from '@/lib/SupabaseContext';
import { fetchProjectRoleWithRetry } from '@/lib/utils/fetchProjectRoleWithRetry';
import { queryKeys } from '@/lib/utils/queryKeys';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function useProjectRoleQuery(
  projectId: string | null,
  userId: string | null | undefined
) {
  const supabase = useSupabase();
  const validProjectId = projectId && UUID_REGEX.test(projectId) ? projectId : null;

  return useQuery({
    queryKey: queryKeys.projectRole(validProjectId ?? '', userId ?? ''),
    queryFn: async () => {
      if (!validProjectId || !userId) {
        return { role: null, isOwner: false } as const;
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return { role: null, isOwner: false } as const;
      return fetchProjectRoleWithRetry(validProjectId, session.access_token);
    },
    enabled: !!validProjectId && !!userId,
    staleTime: 30_000,
  });
}
