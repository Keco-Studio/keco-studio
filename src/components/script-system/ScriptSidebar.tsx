'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/contexts/AuthContext';
import { useSidebarProjects } from '@/components/layout/hooks/useSidebarProjects';
import { useSidebarFoldersLibraries } from '@/components/layout/hooks/useSidebarFoldersLibraries';
import { useSidebarProjectRole } from '@/components/layout/hooks/useSidebarProjectRole';
import { writeScriptProjectPreference } from '@/lib/script-system/projectPreference';
import { useScriptWorkspaceMembership } from './useScriptWorkspaceMembership';
import {
  ScriptContextMenu,
  type ScriptContextMenuType,
} from './ScriptContextMenu';
import {
  useScriptSidebarActions,
  type ScriptSidebarTarget,
} from './useScriptSidebarActions';
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

function DocIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M8 13h8" />
      <path d="M8 17h6" />
    </svg>
  );
}

function SpeechIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
    </svg>
  );
}

type ContextMenuState = {
  x: number;
  y: number;
  type: ScriptContextMenuType;
  id: string;
  name: string;
  elementRef: HTMLElement | null;
};

export function ScriptSidebar({ projectId }: ScriptSidebarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { userProfile } = useAuth();
  const { projects } = useSidebarProjects(userProfile?.id);
  const { userRole } = useSidebarProjectRole(projectId, userProfile?.id);
  const {
    documents: workspaceDocs,
    refetch: refetchWorkspace,
  } = useScriptWorkspaceMembership(projectId);
  const { libraries, refetch: refetchLibraries } =
    useSidebarFoldersLibraries(projectId);

  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const projectMenuRef = useRef<HTMLDivElement | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [expandedDocs, setExpandedDocs] = useState<Set<string>>(new Set());
  const didInitialExpandRef = useRef(false);

  const selectedProject =
    projects.find((project) => project.id === projectId) ?? null;
  const projectName = selectedProject?.name ?? 'Project';
  const onImportRoute =
    pathname === `/script-system/${projectId}` ||
    pathname === `/script-system/${projectId}/`;

  const selectedDocumentId = useMemo(() => {
    const match = pathname?.match(
      new RegExp(`^/script-system/${projectId}/doc/([^/]+)`)
    );
    return match?.[1] ?? null;
  }, [pathname, projectId]);

  const selectedLibraryId = useMemo(() => {
    const match = pathname?.match(
      new RegExp(`^/script-system/${projectId}/script/([^/]+)`)
    );
    return match?.[1] ?? null;
  }, [pathname, projectId]);

  const scriptsByDocument = useMemo(() => {
    const map = new Map<
      string,
      Array<{ id: string; name: string; created_at: string }>
    >();
    for (const lib of libraries) {
      if (
        lib.source_document_id &&
        lib.document_export_type === 'script'
      ) {
        const list = map.get(lib.source_document_id) ?? [];
        list.push({
          id: lib.id,
          name: lib.name,
          created_at: lib.created_at,
        });
        map.set(lib.source_document_id, list);
      }
    }
    for (const [, list] of map) {
      list.sort(
        (a, b) =>
          a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)
      );
    }
    return map;
  }, [libraries]);

  // Expand only the selected route; optionally seed docs-with-children once on first load
  useEffect(() => {
    const shouldSeedInitial =
      !didInitialExpandRef.current &&
      workspaceDocs.some(
        (doc) => (scriptsByDocument.get(doc.documentId) ?? []).length > 0
      );

    if (shouldSeedInitial) {
      didInitialExpandRef.current = true;
    }

    setExpandedDocs((prev) => {
      const next = new Set(prev);
      let changed = false;

      if (shouldSeedInitial) {
        for (const doc of workspaceDocs) {
          const children = scriptsByDocument.get(doc.documentId) ?? [];
          if (children.length > 0 && !next.has(doc.documentId)) {
            next.add(doc.documentId);
            changed = true;
          }
        }
      }

      if (selectedDocumentId && !next.has(selectedDocumentId)) {
        next.add(selectedDocumentId);
        changed = true;
      }
      if (selectedLibraryId) {
        for (const [docId, children] of scriptsByDocument) {
          if (
            children.some((c) => c.id === selectedLibraryId) &&
            !next.has(docId)
          ) {
            next.add(docId);
            changed = true;
          }
        }
      }
      return changed ? next : prev;
    });
  }, [workspaceDocs, scriptsByDocument, selectedLibraryId, selectedDocumentId]);

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

  const refreshAll = useCallback(async () => {
    await Promise.all([refetchWorkspace(), refetchLibraries()]);
  }, [refetchWorkspace, refetchLibraries]);

  const onStartRename = useCallback(
    (target: { type: 'document' | 'script'; id: string }) => {
      const key =
        target.type === 'document'
          ? `document-${target.id}`
          : `script-${target.id}`;
      let name = '';
      if (target.type === 'document') {
        name =
          workspaceDocs.find((d) => d.documentId === target.id)?.title ?? '';
      } else {
        name = libraries.find((l) => l.id === target.id)?.name ?? '';
      }
      setEditingKey(key);
      setEditValue(name);
    },
    [workspaceDocs, libraries]
  );

  const menuTarget: ScriptSidebarTarget = contextMenu
    ? { type: contextMenu.type, id: contextMenu.id, name: contextMenu.name }
    : null;

  const { handleAction, commitRename } = useScriptSidebarActions({
    projectId,
    userRole,
    target: menuTarget,
    onStartRename,
    onRefreshWorkspace: refreshAll,
    onExpandDocument: (documentId) => {
      setExpandedDocs((prev) => {
        if (prev.has(documentId)) return prev;
        const next = new Set(prev);
        next.add(documentId);
        return next;
      });
    },
  });

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

  const openMenu = (
    e: React.MouseEvent,
    type: ScriptContextMenuType,
    id: string,
    name: string
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      type,
      id,
      name,
      elementRef: e.currentTarget as HTMLElement,
    });
  };

  const toggleExpand = (documentId: string) => {
    setExpandedDocs((prev) => {
      const next = new Set(prev);
      if (next.has(documentId)) next.delete(documentId);
      else next.add(documentId);
      return next;
    });
  };

  const finishRename = async () => {
    if (!editingKey) return;
    // Keys are `document-${uuid}` / `script-${uuid}` — uuid has dashes
    const type = editingKey.startsWith('document-') ? 'document' : 'script';
    const targetId = editingKey.slice(type.length + 1);
    const previous =
      type === 'document'
        ? workspaceDocs.find((d) => d.documentId === targetId)?.title ?? ''
        : libraries.find((l) => l.id === targetId)?.name ?? '';
    setEditingKey(null);
    if (editValue.trim() && editValue.trim() !== previous) {
      try {
        await commitRename({ type, id: targetId }, editValue);
      } catch {
        // toast already shown
      }
    }
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

        <ul className={styles.tree} role="tree" aria-label="Workspace documents">
          {workspaceDocs.map((doc) => {
            const children = scriptsByDocument.get(doc.documentId) ?? [];
            const expanded = expandedDocs.has(doc.documentId);
            const docSelected = selectedDocumentId === doc.documentId;
            const docKey = `document-${doc.documentId}`;
            const title = doc.title ?? 'Untitled document';

            return (
              <li key={doc.documentId} role="treeitem" aria-expanded={expanded}>
                <div
                  className={`${styles.treeRow} ${
                    docSelected ? styles.treeRowActive : ''
                  }`}
                  onContextMenu={(e) =>
                    openMenu(e, 'document', doc.documentId, title)
                  }
                >
                  {children.length > 0 ? (
                    <button
                      type="button"
                      className={styles.expandButton}
                      aria-label={expanded ? 'Collapse' : 'Expand'}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleExpand(doc.documentId);
                      }}
                    >
                      <span
                        className={`${styles.expandChevron} ${
                          expanded ? styles.expandChevronOpen : ''
                        }`}
                      >
                        <ChevronDownIcon />
                      </span>
                    </button>
                  ) : (
                    <span className={styles.expandSpacer} />
                  )}
                  <div className={styles.treeItemMain}>
                    <span className={styles.treeIcon}>
                      <DocIcon />
                    </span>
                    {editingKey === docKey ? (
                      <input
                        className={styles.renameInput}
                        value={editValue}
                        autoFocus
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={() => void finishRename()}
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            void finishRename();
                          }
                          if (e.key === 'Escape') {
                            setEditingKey(null);
                          }
                        }}
                      />
                    ) : (
                      <button
                        type="button"
                        className={styles.treeItemButton}
                        aria-current={docSelected ? 'page' : undefined}
                        onClick={() =>
                          router.push(
                            `/script-system/${projectId}/doc/${doc.documentId}`
                          )
                        }
                      >
                        <span className={styles.treeLabel} title={title}>
                          {title}
                        </span>
                      </button>
                    )}
                  </div>
                </div>

                {expanded && children.length > 0 ? (
                  <ul className={styles.treeChildren} role="group">
                    {children.map((child) => {
                      const scriptSelected = selectedLibraryId === child.id;
                      const scriptKey = `script-${child.id}`;
                      return (
                        <li key={child.id} role="treeitem">
                          <div
                            className={`${styles.treeRow} ${styles.treeRowChild} ${
                              scriptSelected ? styles.treeRowActive : ''
                            }`}
                            onContextMenu={(e) =>
                              openMenu(e, 'script', child.id, child.name)
                            }
                          >
                            <span className={styles.expandSpacer} />
                            <div className={styles.treeItemMain}>
                              <span className={styles.treeIcon}>
                                <SpeechIcon />
                              </span>
                              {editingKey === scriptKey ? (
                                <input
                                  className={styles.renameInput}
                                  value={editValue}
                                  autoFocus
                                  onChange={(e) => setEditValue(e.target.value)}
                                  onBlur={() => void finishRename()}
                                  onClick={(e) => e.stopPropagation()}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      void finishRename();
                                    }
                                    if (e.key === 'Escape') {
                                      setEditingKey(null);
                                    }
                                  }}
                                />
                              ) : (
                                <button
                                  type="button"
                                  className={styles.treeItemButton}
                                  aria-current={
                                    scriptSelected ? 'page' : undefined
                                  }
                                  onClick={() =>
                                    router.push(
                                      `/script-system/${projectId}/script/${child.id}`
                                    )
                                  }
                                >
                                  <span
                                    className={styles.treeLabel}
                                    title={child.name}
                                  >
                                    {child.name}
                                  </span>
                                </button>
                              )}
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      </nav>

      {contextMenu ? (
        <ScriptContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          type={contextMenu.type}
          userRole={userRole}
          elementRef={contextMenu.elementRef}
          onClose={() => setContextMenu(null)}
          onAction={handleAction}
        />
      ) : null}
    </aside>
  );
}
