/** Project layout owns the single collaborator channel for all project views. */

'use client';

import { useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useSupabase } from '@/lib/SupabaseContext';
import { useAuth } from '@/lib/contexts/AuthContext';
import { fetchProjectRoleWithRetry } from '@/lib/utils/fetchProjectRoleWithRetry';
import {
  ProjectCollaboratorsRealtimeProvider,
  useProjectCollaboratorsRealtime,
} from '@/lib/hooks/useProjectCollaboratorsRealtime';

export default function ProjectLayout({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const supabase = useSupabase();
  const { userProfile } = useAuth();
  const projectId = params.projectId as string;
  const broadcast = useProjectCollaboratorsRealtime(projectId, userProfile?.id);

  useEffect(() => {
    if (!projectId) return;

    const checkUserAccess = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const role = await fetchProjectRoleWithRetry(projectId, session.access_token);
        if (!role.role) window.location.href = '/projects';
      } catch (error) {
        console.error('[ProjectLayout] Failed to verify project access:', error);
      }
    };

    void checkUserAccess();
    const interval = setInterval(checkUserAccess, 60_000);
    return () => clearInterval(interval);
  }, [projectId, supabase]);

  return (
    <ProjectCollaboratorsRealtimeProvider broadcast={broadcast}>
      {children}
    </ProjectCollaboratorsRealtimeProvider>
  );
}
