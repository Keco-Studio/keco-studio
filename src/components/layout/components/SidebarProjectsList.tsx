'use client';

import { useCallback, useState } from 'react';
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
  userRole: 'admin' | 'editor' | 'viewer' | null;
  onOpenNewProject: () => void;
  onProjectClick: (projectId: string) => void;
  onSaveRename: (key: string, newName: string) => void | Promise<void>;
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
  userRole,
  onOpenNewProject,
  onProjectClick,
  onSaveRename,
  onContextMenu,
}: SidebarProjectsListProps) {
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const startRename = useCallback(
    (project: Project) => {
      if (userRole !== 'admin') return;
      setEditingProjectId(project.id);
      setEditingValue(project.name);
    },
    [userRole]
  );

  const saveRename = useCallback(
    async (projectId: string) => {
      if (isSaving) return;
      const trimmed = editingValue.trim();
      if (!trimmed) return;

      setIsSaving(true);
      try {
        await Promise.resolve(onSaveRename(`project-${projectId}`, trimmed));
        setEditingProjectId(null);
      } catch {
        // Keep edit mode on failure; toast feedback comes from upper-level handler.
      } finally {
        setIsSaving(false);
      }
    },
    [editingValue, isSaving, onSaveRename]
  );

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
          const isEditing = editingProjectId === project.id;
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
              onClick={() => {
                if (isEditing) return;
                onProjectClick(project.id);
              }}
              onContextMenu={(e) => {
                if (isEditing) {
                  e.preventDefault();
                  return;
                }
                onContextMenu(e, 'project', project.id);
              }}
            >
              <Image
                src={projectIcon}
                alt="Project"
                width={24}
                height={24}
                className={`icon-24 ${styles.itemIcon}`}
              />
              {isEditing ? (
                <input
                  className={styles.renameInput}
                  value={editingValue}
                  autoFocus
                  disabled={isSaving}
                  onChange={(e) => setEditingValue(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={() => {
                    void saveRename(project.id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      e.stopPropagation();
                      void saveRename(project.id);
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      e.stopPropagation();
                      setEditingProjectId(null);
                    }
                  }}
                />
              ) : (
                <span
                  className={styles.itemText}
                  title={project.name}
                  onDoubleClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    startRename(project);
                  }}
                >
                  {truncateText(project.name, 20)}
                </span>
              )}
              <span className={styles.itemActions}>
                {!isEditing && project.description && (
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
