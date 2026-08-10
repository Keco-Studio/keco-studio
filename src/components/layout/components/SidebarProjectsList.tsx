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
  userRole: 'admin' | 'editor' | 'viewer' | null;
  onOpenNewProject: () => void;
  onProjectClick: (projectId: string) => void;
  onSaveRename: (key: string, newName: string) => void | Promise<void>;
  onContextMenu: (e: React.MouseEvent, type: 'project', id: string) => void;
};

/**
 * Renders the compact project selector in the Sidebar.
 */
export function SidebarProjectsList({
  projects,
  loadingProjects,
  currentProjectId,
  userRole,
  onOpenNewProject,
  onProjectClick,
  onSaveRename,
  onContextMenu,
}: SidebarProjectsListProps) {
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isSelectorOpen, setIsSelectorOpen] = useState(false);
  const selectorRef = useRef<HTMLDivElement>(null);
  const pendingProjectSelectionRef = useRef<number | null>(null);

  const currentProject = useMemo(
    () => projects.find((project) => project.id === currentProjectId),
    [currentProjectId, projects]
  );

  const cancelPendingProjectSelection = useCallback(() => {
    if (pendingProjectSelectionRef.current === null) return;
    window.clearTimeout(pendingProjectSelectionRef.current);
    pendingProjectSelectionRef.current = null;
  }, []);

  const startRename = useCallback(
    (project: Project) => {
      if (userRole !== 'admin') return;
      cancelPendingProjectSelection();
      setEditingProjectId(project.id);
      setEditingValue(project.name);
    },
    [cancelPendingProjectSelection, userRole]
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

  useEffect(() => {
    if (!isSelectorOpen) return;

    const closeFromOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !selectorRef.current?.contains(event.target)) {
        cancelPendingProjectSelection();
        setEditingProjectId(null);
        setIsSelectorOpen(false);
      }
    };
    const closeFromKeyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        cancelPendingProjectSelection();
        setEditingProjectId(null);
        setIsSelectorOpen(false);
      }
    };

    document.addEventListener('pointerdown', closeFromOutside);
    window.addEventListener('keydown', closeFromKeyboard);
    return () => {
      cancelPendingProjectSelection();
      document.removeEventListener('pointerdown', closeFromOutside);
      window.removeEventListener('keydown', closeFromKeyboard);
    };
  }, [cancelPendingProjectSelection, isSelectorOpen]);

  const selectProject = useCallback(
    (projectId: string) => {
      onProjectClick(projectId);
      setIsSelectorOpen(false);
    },
    [onProjectClick]
  );

  const queueProjectSelection = useCallback(
    (projectId: string) => {
      if (userRole !== 'admin') {
        selectProject(projectId);
        return;
      }

      cancelPendingProjectSelection();
      pendingProjectSelectionRef.current = window.setTimeout(() => {
        pendingProjectSelectionRef.current = null;
        selectProject(projectId);
      }, 220);
    },
    [cancelPendingProjectSelection, selectProject, userRole]
  );

  return (
    <div className={styles.projectsSection} ref={selectorRef}>
      <button
        type="button"
        className={styles.projectSelectorTrigger}
        aria-label="Select project"
        aria-haspopup="menu"
        aria-expanded={isSelectorOpen}
        onClick={() => {
          cancelPendingProjectSelection();
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
              const isEditing = editingProjectId === project.id;
              const isCurrentProject = currentProjectId === project.id;
              return (
                <div
                  key={project.id}
                  className={`${styles.projectSelectorOption} ${isCurrentProject ? styles.projectSelectorOptionSelected : ''}`}
                  role="menuitemradio"
                  aria-checked={isCurrentProject}
                  tabIndex={0}
                  onClick={() => {
                    if (!isEditing) queueProjectSelection(project.id);
                  }}
                  onKeyDown={(event) => {
                    if (isEditing || event.target instanceof HTMLInputElement) return;
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      selectProject(project.id);
                    }
                  }}
                  onContextMenu={(e) => {
                    if (isEditing) {
                      e.preventDefault();
                      return;
                    }
                    onContextMenu(e, 'project', project.id);
                  }}
                >
                  {isEditing ? (
                    <input
                      className={styles.projectSelectorRenameInput}
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
                      className={styles.projectSelectorOptionText}
                      title={project.name}
                      onDoubleClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        startRename(project);
                      }}
                    >
                      {project.name}
                    </span>
                  )}
                  {!isEditing && project.description && (
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
                    {isCurrentProject && !isEditing && <CheckOutlined />}
                  </span>
                </div>
              );
            })}
          </div>
          <button
            type="button"
            role="menuitem"
            className={styles.projectSelectorCreate}
            onClick={() => {
              cancelPendingProjectSelection();
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
