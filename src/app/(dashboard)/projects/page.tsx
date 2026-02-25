'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSupabase } from '@/lib/SupabaseContext';
import { useAuth } from '@/lib/contexts/AuthContext';
import { listProjects, Project } from '@/lib/services/projectService';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { NewProjectModal } from '@/components/projects/NewProjectModal';
import { useNavigation } from '@/lib/contexts/NavigationContext';
import { globalRequestCache } from '@/lib/hooks/useRequestCache';
import projectEmptyIcon from '@/assets/images/projectEmptyIcon_2.png';
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

  // When userProfile.id is available, pass it to skip getCurrentUserId/getUser(), avoiding slow
  // auth round-trip on first login. Otherwise fall back to getCurrentUserId.
  const {
    data: projects = [],
    isLoading: loading,
    error: projectsError,
  } = useQuery({
    queryKey: ['projects'],
    queryFn: () => listProjects(supabase, userProfile?.id),
    enabled: true,
    staleTime: 2 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  // Listen to projectCreated event to refresh cache
  useEffect(() => {
    const handleProjectCreated = () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    };

    window.addEventListener('projectCreated' as any, handleProjectCreated as EventListener);
    
    return () => {
      window.removeEventListener('projectCreated' as any, handleProjectCreated as EventListener);
    };
  }, [queryClient]);

  // Listen to authStateChanged event to clear React Query cache when user signs out or switches
  useEffect(() => {
    const handleAuthStateChanged = () => {
      // Clear all React Query cache when auth state changes (sign out or user switch)
      queryClient.clear();
    };

    window.addEventListener('authStateChanged' as any, handleAuthStateChanged as EventListener);
    
    return () => {
      window.removeEventListener('authStateChanged' as any, handleAuthStateChanged as EventListener);
    };
  }, [queryClient]);

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

  const handleCreated = async (projectId: string) => {
    queryClient.invalidateQueries({ queryKey: ['projects'] });
    if (userProfile?.id) {
      globalRequestCache.invalidate(`projects:list:${userProfile.id}`);
    }
    window.dispatchEvent(new CustomEvent('projectCreated'));
    router.push(`/${projectId}`);
  };

  const goToProject = (id: string) => {
    router.push(`/${id}`);
  };

  const showEmpty = !loading && !projectsError && projects.length === 0;

  return (
    <div className={styles.container}>
      {loading && <div>Loading projects...</div>}
      {projectsError && (
        <div className={styles.error}>
          {(projectsError as any)?.message || 'Failed to load projects'}
        </div>
      )}

      {showEmpty && (
        <div className={styles.emptyStateWrapper}>
          <div className={styles.emptyStateContainer}>
            <div className={styles.emptyIcon}>
              <Image
                src={projectEmptyIcon}
                alt="Project icon"
                fill
                className={styles.emptyIconImage}
              />
            </div>
            <div className={styles.emptyText}>
              There is no any project here. create your first project.
            </div>
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
          </div>
        </div>
      )}

      <NewProjectModal open={showModal} onClose={() => setShowModal(false)} onCreated={handleCreated} />
    </div>
  );
}

