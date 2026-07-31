'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/contexts/AuthContext';
import { useSidebarProjects } from '@/components/layout/hooks/useSidebarProjects';
import { writeScriptProjectPreference } from '@/lib/script-system/projectPreference';
import styles from './ScriptSidebar.module.css';

export type ScriptSidebarProps = {
  projectId: string;
};

function ImportIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export function ScriptSidebar({ projectId }: ScriptSidebarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { userProfile } = useAuth();
  const { projects } = useSidebarProjects(userProfile?.id);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const projectMenuRef = useRef<HTMLDivElement | null>(null);

  const selectedProject =
    projects.find((project) => project.id === projectId) ?? null;
  const projectName = selectedProject?.name ?? 'Project';
  const onImportRoute =
    pathname === `/script-system/${projectId}` ||
    pathname === `/script-system/${projectId}/`;

  useEffect(() => {
    if (!projectMenuOpen) return;
    function onDocMouseDown(event: MouseEvent) {
      if (
        projectMenuRef.current &&
        !projectMenuRef.current.contains(event.target as Node)
      ) {
        setProjectMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [projectMenuOpen]);

  const goToImport = () => {
    router.push(`/script-system/${projectId}`);
  };

  const selectProject = (nextProjectId: string, nextProjectName: string) => {
    writeScriptProjectPreference({
      projectId: nextProjectId,
      projectName: nextProjectName,
    });
    setProjectMenuOpen(false);
    router.push(`/script-system/${nextProjectId}`);
  };

  return (
    <aside className={styles.sidebar} aria-label="Keco Script workspace">
      <div className={styles.brand}>
        <strong className={styles.brandTitle}>Keco Script</strong>
        <p className={styles.brandSubtitle}>
          Manage and config game assets for game designers.
        </p>
      </div>

      <div ref={projectMenuRef} className={styles.projectWrap}>
        <button
          type="button"
          className={styles.projectButton}
          title="Project"
          aria-haspopup="listbox"
          aria-expanded={projectMenuOpen}
          onClick={() => setProjectMenuOpen((open) => !open)}
        >
          <span className={styles.projectName}>{projectName}</span>
          <span className={styles.chevron}>
            <ChevronDownIcon />
          </span>
        </button>
        {projectMenuOpen && projects.length > 0 ? (
          <div className={styles.projectMenu} role="listbox" aria-label="Projects">
            {projects.map((project) => {
              const selected = project.id === projectId;
              return (
                <button
                  key={project.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={`${styles.projectOption} ${
                    selected ? styles.projectOptionSelected : ''
                  }`}
                  onClick={() => selectProject(project.id, project.name)}
                >
                  {project.name}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      <nav className={styles.nav} aria-label="Script navigation">
        <button
          type="button"
          className={`${styles.importButton} ${
            onImportRoute ? styles.importButtonActive : ''
          }`}
          aria-current={onImportRoute ? 'page' : undefined}
          onClick={goToImport}
        >
          <span className={styles.importIcon}>
            <ImportIcon />
          </span>
          <span>Import</span>
        </button>
      </nav>
    </aside>
  );
}
