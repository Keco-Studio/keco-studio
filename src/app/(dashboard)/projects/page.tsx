'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSupabase } from '@/lib/SupabaseContext';
import { useAuth } from '@/lib/contexts/AuthContext';
import { listProjects } from '@/lib/services/projectService';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { NewProjectModal, type CreatedProjectPayload } from '@/components/projects/NewProjectModal';
import { useNavigation } from '@/lib/contexts/NavigationContext';
import { patchProjectFoundationCaches } from '@/lib/queryInvalidation';
import { queryKeys } from '@/lib/utils/queryKeys';
import type { Folder } from '@/lib/services/folderService';
import { EmptyContentState } from '@/components/shared/EmptyContentState';
import plusHorizontal from '@/assets/images/plusHorizontal.svg';
import plusVertical from '@/assets/images/plusVertical.svg';
import Image from 'next/image';
import styles from './page.module.css';

export default function ProjectsPage() {
  const supabase = useSupabase();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { userProfile } = useAuth();
  const { setShowCreateProjectBreadcrumb } = useNavigation();
  const [showModal, setShowModal] = useState(false);

  const {
    data: projects = [],
    isLoading: projectsLoading,
    error: projectsError,
  } = useQuery({
    queryKey: ['projects', userProfile?.id],
    queryFn: () => listProjects(supabase, userProfile?.id),
    enabled: Boolean(userProfile?.id),
    staleTime: 2 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });
  const loading = !userProfile?.id || projectsLoading;

  // Check for pending invitation token after user logs in
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const pendingToken = sessionStorage.getItem('pendingInvitationToken');
      if (pendingToken) {
        // Redirect to accept-invitation page to process the token
        router.push('/accept-invitation');
      }
    }
  }, [router]);

  useEffect(() => {
    const ready = !loading && !projectsError;
    setShowCreateProjectBreadcrumb(ready && projects.length === 0);
    return () => {
      setShowCreateProjectBreadcrumb(false);
    };
  }, [loading, projectsError, projects.length, setShowCreateProjectBreadcrumb]);

  const handleCreated = ({ project, defaultFolderId }: CreatedProjectPayload) => {
    patchProjectFoundationCaches(queryClient, project);
    const optimisticFolder: Folder = {
      id: defaultFolderId,
      project_id: project.id,
      parent_folder_id: null,
      name: 'Resources Folder',
      description: 'Default resources folder',
      created_at: project.created_at,
      updated_at: project.created_at,
      updated_by: project.owner_id,
    };
    queryClient.setQueryData<Folder[]>(queryKeys.projectFolders(project.id), [optimisticFolder]);
    router.push(`/${project.id}/recent`);
    void queryClient.invalidateQueries({ queryKey: ['projects'] });
    void queryClient.invalidateQueries({ queryKey: queryKeys.projectFolders(project.id) });
    void queryClient.invalidateQueries({ queryKey: ['folders-libraries', project.id] });
  };

  const showEmpty = !loading && !projectsError && projects.length === 0;

  return (
    <div className={styles.container}>
      {loading && <div>Loading projects...</div>}
      {projectsError && (
        <div className={styles.error}>
          {projectsError instanceof Error ? projectsError.message : 'Failed to load projects'}
        </div>
      )}

      {showEmpty && (
        <div className={styles.emptyStateWrapper}>
          <EmptyContentState message="There is no any project here. create your first project.">
            <button
              className={styles.createProjectButton}
              onClick={() => setShowModal(true)}
            >
              <span className={styles.plusIcon}>
                <Image
                  src={plusHorizontal}
                  alt=""
                  width={17}
                  height={2}
                  className={styles.plusHorizontal}
                />
                <Image
                  src={plusVertical}
                  alt=""
                  width={2}
                  height={17}
                  className={styles.plusVertical}
                />
              </span>
              <span className={styles.buttonText}>Create first project</span>
            </button>
          </EmptyContentState>
        </div>
      )}

      <NewProjectModal open={showModal} onClose={() => setShowModal(false)} onCreated={handleCreated} />
    </div>
  );
}
