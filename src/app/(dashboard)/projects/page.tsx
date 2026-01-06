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

  useEffect(() => {
    // Show create project breadcrumb when there are no projects
    setShowCreateProjectBreadcrumb(!loading && projects.length === 0);
    return () => {
      setShowCreateProjectBreadcrumb(false);
    };
  }, [loading, projects.length, setShowCreateProjectBreadcrumb]);

  const handleCreated = (projectId: string) => {
    // Refresh cache
    queryClient.invalidateQueries({ queryKey: ['projects'] });
    // Dispatch event to notify Sidebar to refresh
    window.dispatchEvent(new CustomEvent('projectCreated'));
    router.push(`/${projectId}`);
  };

  const goToProject = (id: string) => {
    router.push(`/${id}`);
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>Projects</h1>
        {!loading && projects.length > 0 && (
          <button
            onClick={() => setShowModal(true)}
            className={styles.newProjectButton}
          >
            New Project
          </button>
        )}
      </div>

      {loading && <div>Loading projects...</div>}
      {projectsError && <div className={styles.error}>{(projectsError as any)?.message || 'Failed to load projects'}</div>}

      {!loading && projects.length === 0 ? (
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
      ) : (
        <div className={styles.projectsGrid}>
        {projects.map((project) => (
          <div
            key={project.id}
            onClick={() => goToProject(project.id)}
            className={styles.projectCard}
          >
            <div className={styles.projectName}>{project.name}</div>
            {project.description && (
              <div className={styles.projectDescription}>
                {project.description}
              </div>
            )}
          </div>
        ))}
        </div>
      )}

      <NewProjectModal open={showModal} onClose={() => setShowModal(false)} onCreated={handleCreated} />
    </div>
  );
}

