'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSupabase } from '@/lib/SupabaseContext';
import { listProjects, Project } from '@/lib/services/projectService';
import { NewProjectModal } from '@/components/projects/NewProjectModal';
import styles from './page.module.css';

export default function ProjectsPage() {
  const supabase = useSupabase();
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchProjects = async () => {
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
  };

  useEffect(() => {
    fetchProjects();
  }, []);

  const handleCreated = (projectId: string) => {
    fetchProjects();
    router.push(`/${projectId}`);
  };

  const goToProject = (id: string) => {
    router.push(`/${id}`);
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>Projects</h1>
        <button
          onClick={() => setShowModal(true)}
          className={styles.newProjectButton}
        >
          New Project
        </button>
      </div>

      {loading && <div>Loading projects...</div>}
      {error && <div className={styles.error}>{error}</div>}

      {!loading && projects.length === 0 && (
        <div className={styles.emptyMessage}>No projects yet. Create your first project.</div>
      )}

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

      <NewProjectModal open={showModal} onClose={() => setShowModal(false)} onCreated={handleCreated} />
    </div>
  );
}

