'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MenuOutlined, ReloadOutlined } from '@ant-design/icons';
import { fetchGameDesignSystem, fetchGameDesignSystems } from '@/lib/services/gameDesignSystemClient';
import { queryKeys } from '@/lib/utils/queryKeys';
import { useAuth } from '@/lib/contexts/AuthContext';
import { GameDesignSystemCreatePage } from './GameDesignSystemCreatePage';
import {
  GameDesignSystemLibrary,
  visibleGameDesignSystems,
  type GameDesignSystemScope,
} from './GameDesignSystemLibrary';
import { GameDesignSystemWorkspace, type ProjectOption } from './GameDesignSystemWorkspace';
import styles from './GameDesignSystemsPage.module.css';

type WorkspaceMode = 'system' | 'create';

async function fetchProjects(): Promise<ProjectOption[]> {
  const response = await fetch('/api/projects/writable', { cache: 'no-store' });
  if (!response.ok) throw new Error('Failed to load projects.');
  return (await response.json()) as ProjectOption[];
}

export function GameDesignSystemsPage() {
  const { userProfile } = useAuth();
  const viewerUserId = userProfile?.id ?? '';
  const [scope, setScope] = useState<GameDesignSystemScope>('mine');
  const [search, setSearch] = useState('');
  const [mode, setMode] = useState<WorkspaceMode>('system');
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [workspaceDirty, setWorkspaceDirty] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(() => (
    typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('systemId')
  ));

  const systemsQuery = useQuery({ queryKey: queryKeys.gameDesignSystems(), queryFn: fetchGameDesignSystems });
  const projectsQuery = useQuery({ queryKey: queryKeys.projects(), queryFn: fetchProjects });
  const systems = useMemo(() => systemsQuery.data ?? [], [systemsQuery.data]);
  const visible = useMemo(
    () => visibleGameDesignSystems(systems, scope, viewerUserId, search),
    [systems, scope, viewerUserId, search],
  );
  const resolvedSelectedId = visible.some((system) => system.id === selectedId)
    ? selectedId
    : visible[0]?.id ?? null;
  const detailQuery = useQuery({
    queryKey: queryKeys.gameDesignSystem(resolvedSelectedId ?? 'none'),
    queryFn: () => fetchGameDesignSystem(resolvedSelectedId!),
    enabled: Boolean(resolvedSelectedId && mode === 'system'),
  });

  useEffect(() => {
    if (!workspaceDirty) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [workspaceDirty]);

  function leaveDirtyWorkspace(action: () => void) {
    if (workspaceDirty && !window.confirm('Discard unsaved Game Design System changes?')) return;
    setWorkspaceDirty(false);
    action();
  }

  function selectSystem(id: string) {
    if (id === resolvedSelectedId) {
      setLibraryOpen(false);
      return;
    }
    leaveDirtyWorkspace(() => {
      setSelectedId(id);
      setMode('system');
      setLibraryOpen(false);
    });
  }

  function changeScope(nextScope: GameDesignSystemScope) {
    if (nextScope === scope) return;
    leaveDirtyWorkspace(() => {
      setSelectedId(null);
      setScope(nextScope);
      setSearch('');
      setMode('system');
    });
  }

  function changeSearch(value: string) {
    const nextVisible = visibleGameDesignSystems(systems, scope, viewerUserId, value);
    if (resolvedSelectedId && !nextVisible.some((system) => system.id === resolvedSelectedId)) {
      leaveDirtyWorkspace(() => {
        setSelectedId(null);
        setSearch(value);
      });
      return;
    }
    setSearch(value);
  }

  function completeCreation(systemId: string) {
    setScope('mine');
    setSearch('');
    setSelectedId(systemId);
    setMode('system');
  }

  const detailVisible = mode === 'system' && Boolean(resolvedSelectedId);

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <button className={styles.libraryToggle} type="button" aria-label="Show system library" title="Show system library" onClick={() => setLibraryOpen(true)}><MenuOutlined /></button>
        {libraryOpen ? <button className={styles.drawerScrim} type="button" aria-label="Close system library" onClick={() => setLibraryOpen(false)} /> : null}
        <div className={libraryOpen ? styles.libraryDrawerOpen : styles.libraryDrawer}>
          <GameDesignSystemLibrary
            systems={systems}
            scope={scope}
            search={search}
            selectedId={mode === 'system' ? resolvedSelectedId : null}
            viewerUserId={viewerUserId}
            loading={systemsQuery.isLoading}
            error={systemsQuery.isError}
            onScopeChange={changeScope}
            onSearchChange={changeSearch}
            onSelect={selectSystem}
            onCreate={() => leaveDirtyWorkspace(() => { setMode('create'); setLibraryOpen(false); })}
            onRetry={() => void systemsQuery.refetch()}
          />
        </div>

        {mode === 'create' ? (
          <GameDesignSystemCreatePage embedded onCancel={() => setMode('system')} onCompleted={completeCreation} />
        ) : !detailVisible ? (
          <section className={styles.workspaceState}>
            <div>
              <h2>{scope === 'official' ? 'Official systems are not available yet' : 'Choose a system'}</h2>
              <p>{scope === 'official' ? 'This library will remain empty until official presets are deliberately designed and published.' : 'Select a system from the library or create a new one.'}</p>
            </div>
          </section>
        ) : detailQuery.isLoading ? (
          <section className={styles.workspace} aria-busy="true"><div className={styles.skeleton} /><div className={styles.skeleton} /><div className={styles.skeleton} /></section>
        ) : detailQuery.isError ? (
          <section className={styles.workspaceState}>
            <div><h2>Failed to load system</h2><button className={styles.secondaryButton} type="button" onClick={() => detailQuery.refetch()}><ReloadOutlined /> Retry</button></div>
          </section>
        ) : detailQuery.data ? (
          <GameDesignSystemWorkspace
            key={detailQuery.data.id}
            detail={detailQuery.data}
            viewerUserId={viewerUserId}
            projects={projectsQuery.data ?? []}
            projectsLoading={projectsQuery.isLoading}
            projectsError={projectsQuery.isError}
            onRetryProjects={() => void projectsQuery.refetch()}
            onDeleted={() => setSelectedId(null)}
            onDirtyChange={setWorkspaceDirty}
          />
        ) : (
          <section className={styles.workspaceState}><div><h2>System unavailable</h2><p>The system does not exist or you do not have access.</p></div></section>
        )}
      </div>
    </main>
  );
}
