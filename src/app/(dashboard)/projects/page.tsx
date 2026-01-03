'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSupabase } from '@/lib/SupabaseContext';
import { listProjects, Project } from '@/lib/services/projectService';
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
  const { setShowCreateProjectBreadcrumb } = useNavigation();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchProjects = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listProjects(supabase);
      setProjects(data);
    } catch (e: any) {
      setError(e?.message || 'Failed to load projects');
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  // Listen to projectCreated event to refresh when project is created from Sidebar
  useEffect(() => {
    const handleProjectCreated = () => {
      fetchProjects();
    };

    window.addEventListener('projectCreated' as any, handleProjectCreated as EventListener);
    
    return () => {
      window.removeEventListener('projectCreated' as any, handleProjectCreated as EventListener);
    };
  }, [fetchProjects]);

  useEffect(() => {
    // Show create project breadcrumb when there are no projects
    setShowCreateProjectBreadcrumb(!loading && projects.length === 0);
    return () => {
      setShowCreateProjectBreadcrumb(false);
    };
  }, [loading, projects.length, setShowCreateProjectBreadcrumb]);

  const handleCreated = (projectId: string) => {
    fetchProjects();
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
      {error && <div className={styles.error}>{error}</div>}

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

