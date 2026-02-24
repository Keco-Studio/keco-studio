'use client';

import Image from 'next/image';
import { Tooltip } from 'antd';
import type { Project } from '@/lib/services/projectService';
import { truncateText } from '@/lib/utils/truncateText';
import projectIcon from '@/assets/images/projectIcon.svg';
import addProjectIcon from '@/assets/images/addProjectIcon.svg';
import createProjectIcon from '@/assets/images/createProjectIcon.svg';
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
 * Renders the Projects section (title, list, create button) in the Sidebar.
 */
export function SidebarProjectsList({
  projects,
  loadingProjects,
  currentProjectId,
  currentLibraryId,
  currentFolderId,
  onOpenNewProject,
  onProjectClick,
  onContextMenu,
}: SidebarProjectsListProps) {
  return (
    <>
      <div className={styles.sectionTitle}>
        <span>Projects</span>
        <button
          className={styles.addButton}
          onClick={onOpenNewProject}
          title="New Project"
        >
          <Image
            src={addProjectIcon}
            alt="Add project"
            width={16}
            height={16}
            className="icon-16"
          />
        </button>
      </div>
      <div className={styles.projectsListContainer}>
        {projects.map((project) => {
          const isCurrentProject = currentProjectId === project.id;
          // Project is "active" (blue highlight) only when on project page without folder/library
          const isActive = isCurrentProject && !currentLibraryId && !currentFolderId;
          // Project has "secondary" highlight (gray) when viewing folder/library under this project
          const isSecondaryActive = isCurrentProject && (currentLibraryId || currentFolderId);
          return (
            <div
              key={project.id}
              className={`${styles.item} ${
                isActive 
                  ? styles.itemActive 
                  : isSecondaryActive 
                  ? styles.itemSecondaryActive 
                  : styles.itemInactive
              }`}
              onClick={() => onProjectClick(project.id)}
              onContextMenu={(e) => onContextMenu(e, 'project', project.id)}
            >
              <Image
                src={projectIcon}
                alt="Project"
                width={24}
                height={24}
                className={`icon-24 ${styles.itemIcon}`}
              />
              <span className={styles.itemText} title={project.name}>
                {truncateText(project.name, 20)}
              </span>
              <span className={styles.itemActions}>
                {project.description && (
                  <Tooltip
                    title={project.description}
                    placement="top"
                    styles={{ root: { maxWidth: '300px' } }}
                  >
                    <div
                      className={styles.infoIconWrapper}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Image
                        src={projectRightIcon}
                        alt="Info"
                        width={24}
                        height={24}
                        className="icon-24"
                      />
                    </div>
                  </Tooltip>
                )}
              </span>
            </div>
          );
        })}
        {!loadingProjects && projects.length === 0 && (
          <button
            className={styles.createProjectButton}
            onClick={onOpenNewProject}
          >
            <Image
              src={createProjectIcon}
              alt="Project"
              width={24}
              height={24}
              className={`icon-24 ${styles.itemIcon}`}
            />
            <span className={styles.itemText}>Create Project</span>
          </button>
        )}
      </div>
    </>
  );
}
