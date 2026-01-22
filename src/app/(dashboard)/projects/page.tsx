'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSupabase } from '@/lib/SupabaseContext';
import { listProjects, Project } from '@/lib/services/projectService';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { NewProjectModal } from '@/components/projects/NewProjectModal';
import { useNavigation } from '@/lib/contexts/NavigationContext';
import projectEmptyIcon from '@/app/assets/images/projectEmptyIcon.svg';
import plusHorizontal from '@/app/assets/images/plusHorizontal.svg';
import plusVertical from '@/app/assets/images/plusVertical.svg';
import Image from 'next/image';
import styles from './page.module.css';

export default function ProjectsPage() {
  const supabase = useSupabase();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { setShowCreateProjectBreadcrumb } = useNavigation();
  const [showModal, setShowModal] = useState(false);

  // Use React Query to fetch projects list, sharing the same cache with Sidebar
  // This ensures data synchronization between both components after project deletion
  const {
    data: projects = [],
    isLoading: loading,
    error: projectsError,
  } = useQuery({
    queryKey: ['projects'],
    queryFn: () => listProjects(supabase),
    staleTime: 2 * 60 * 1000, // Keep consistent with Sidebar
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
    // Show create project breadcrumb when there are no projects
    setShowCreateProjectBreadcrumb(!loading && projects.length === 0);
    return () => {
      setShowCreateProjectBreadcrumb(false);
    };
  }, [loading, projects.length, setShowCreateProjectBreadcrumb]);

  const handleCreated = async (projectId: string) => {
    // Refresh React Query cache
    queryClient.invalidateQueries({ queryKey: ['projects'] });
    
    // Also invalidate globalRequestCache for projects list
    const { globalRequestCache } = await import('@/lib/hooks/useRequestCache');
    const { getCurrentUserId } = await import('@/lib/services/authorizationService');
    try {
      const userId = await getCurrentUserId(supabase);
      globalRequestCache.invalidate(`projects:list:${userId}`);
    } catch (err) {
      console.warn('Failed to get userId for cache invalidation, clearing all project cache', err);
    }
    
    // Dispatch event to notify Sidebar to refresh
    window.dispatchEvent(new CustomEvent('projectCreated'));
    router.push(`/${projectId}`);
  };

  const goToProject = (id: string) => {
    router.push(`/${id}`);
  };

  return (
    <div className={styles.container}>
      {loading && <div>Loading projects...</div>}
      {projectsError && <div className={styles.error}>{(projectsError as any)?.message || 'Failed to load projects'}</div>}

      {!loading && projects.length === 0 && (
        <div className={styles.emptyStateWrapper}>
          <div className={styles.emptyStateContainer}>
            <div className={styles.emptyIcon}>
              <Image
                src={projectEmptyIcon}
                alt="Project icon"
                width={59}
                height={64}
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

