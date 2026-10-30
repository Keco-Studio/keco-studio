'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { Tooltip } from 'antd';
import { CheckOutlined, DownOutlined } from '@ant-design/icons';
import type { Project } from '@/lib/services/projectService';
import projectRightIcon from '@/assets/images/ProjectDescIcon.svg';
import styles from '../Sidebar.module.css';

export type SidebarProjectsListProps = {
  projects: Project[];
  loadingProjects: boolean;
  currentProjectId: string | null;
  currentLibraryId: string | null;
  currentFolderId: string | null;
  onOpenNewProject: () => void;
  onProjectClick: (projectId: string) => void;
  onContextMenu: (e: React.MouseEvent, type: 'project', id: string) => void;
};

/**
 * Renders the compact project selector in the Sidebar.
 */
export function SidebarProjectsList({
  projects,
  loadingProjects,
  currentProjectId,
  onOpenNewProject,
  onProjectClick,
  onContextMenu,
}: SidebarProjectsListProps) {
  const [isSelectorOpen, setIsSelectorOpen] = useState(false);
  const selectorRef = useRef<HTMLDivElement>(null);
  const selectedOptionRef = useRef<HTMLDivElement | null>(null);

  const currentProject = useMemo(
    () => projects.find((project) => project.id === currentProjectId),
    [currentProjectId, projects]
  );

  useEffect(() => {
    if (!isSelectorOpen) return;

    const closeFromOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !selectorRef.current?.contains(event.target)) {
        setIsSelectorOpen(false);
      }
    };
    const closeFromKeyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsSelectorOpen(false);
      }
    };

    document.addEventListener('pointerdown', closeFromOutside);
    window.addEventListener('keydown', closeFromKeyboard);
    return () => {
      document.removeEventListener('pointerdown', closeFromOutside);
      window.removeEventListener('keydown', closeFromKeyboard);
    };
  }, [isSelectorOpen]);

  // Keep the active project visible inside the 3-row scroll window.
  useEffect(() => {
    if (!isSelectorOpen) return;
    selectedOptionRef.current?.scrollIntoView({ block: 'nearest' });
  }, [isSelectorOpen, currentProjectId, projects]);

  const selectProject = useCallback(
    (projectId: string) => {
      onProjectClick(projectId);
      setIsSelectorOpen(false);
    },
    [onProjectClick]
  );

  return (
    <div className={styles.projectsSection} ref={selectorRef}>
      <button
        type="button"
        className={styles.projectSelectorTrigger}
        aria-label="Select project"
        aria-haspopup="menu"
        aria-expanded={isSelectorOpen}
        data-testid="project-selector-trigger"
        onClick={() => {
          setIsSelectorOpen((open) => !open);
        }}
      >
        <span className={styles.projectSelectorTriggerText}>
          {currentProject?.name ?? (loadingProjects ? 'Loading projects...' : 'Select project')}
        </span>
        <DownOutlined
          aria-hidden="true"
          className={`${styles.projectSelectorChevron} ${isSelectorOpen ? styles.projectSelectorChevronOpen : ''}`}
        />
      </button>

      {isSelectorOpen && (
        <div className={styles.projectSelectorMenu} role="menu" aria-label="Projects">
          <div className={styles.projectSelectorOptions}>
            {projects.map((project) => {
              const isCurrentProject = currentProjectId === project.id;
              return (
                <div
                  key={project.id}
                  ref={isCurrentProject ? selectedOptionRef : undefined}
                  className={`${styles.projectSelectorOption} ${isCurrentProject ? styles.projectSelectorOptionSelected : ''}`}
                  role="menuitemradio"
                  aria-checked={isCurrentProject}
                  tabIndex={0}
                  onClick={() => selectProject(project.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      selectProject(project.id);
                    }
                  }}
                  onContextMenu={(e) => {
                    onContextMenu(e, 'project', project.id);
                  }}
                >
                  <span className={styles.projectSelectorOptionText} title={project.name}>
                    {project.name}
                  </span>
                  {project.description && (
                    <Tooltip
                      title={project.description}
                      placement="top"
                      styles={{ root: { maxWidth: '300px' } }}
                    >
                      <span
                        className={styles.projectSelectorInfo}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Image src={projectRightIcon} alt="Info" width={18} height={18} />
                      </span>
                    </Tooltip>
                  )}
                  <span className={styles.projectSelectorCheck} aria-hidden="true">
                    {isCurrentProject && <CheckOutlined />}
                  </span>
                </div>
              );
            })}
          </div>
          <button
            type="button"
            role="menuitem"
            className={styles.projectSelectorCreate}
            data-testid="project-selector-create"
            onClick={() => {
              setIsSelectorOpen(false);
              onOpenNewProject();
            }}
          >
            Create new
          </button>
        </div>
      )}
    </div>
  );
}
