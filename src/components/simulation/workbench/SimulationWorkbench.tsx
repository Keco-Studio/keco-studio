'use client';

import Link from 'next/link';
import { createPortal } from 'react-dom';
import { useEffect, useState } from 'react';
import { STEPS } from '@/lib/simulation/data';
import { useSimulationProject } from '@/lib/simulation/SimulationProjectProvider';
import { useSimulationSession } from '@/lib/simulation/SimulationSessionProvider';
import type { SimulationScreen } from '@/lib/simulation/types';
import { BattleScreen } from './BattleScreen';
import { CharactersScreen } from './CharactersScreen';
import { ImportScreen } from './ImportScreen';
import { ProgressionScreen } from './ProgressionScreen';
import { SimulationHeader } from './SimulationHeader';
import { SimulationSidebar } from './SimulationSidebar';
import { SimulationToast } from './SimulationToast';
import { SkillsScreen } from './SkillsScreen';
import styles from './SimulationWorkbench.module.css';
import './simulationTokens.css';

type WorkbenchScreen = 'import' | SimulationScreen;
type RequestedScreen = {
  projectId: string | null;
  sessionId: string;
  screen: SimulationScreen;
};

export function SimulationWorkbench() {
  const project = useSimulationProject();
  const sessions = useSimulationSession();
  const [requestedScreen, setRequestedScreen] = useState<RequestedScreen | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [holdImportScreen, setHoldImportScreen] = useState(false);
  const [sidebarHost, setSidebarHost] = useState<HTMLElement | null>(null);
  const [headerHost, setHeaderHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setSidebarHost(document.querySelector<HTMLElement>('[data-simulation-sidebar-slot]'));
    setHeaderHost(document.querySelector<HTMLElement>('[data-simulation-header-slot]'));

    const toggleSidebar = () => setCollapsed((value) => !value);
    window.addEventListener('sidebar-toggle', toggleSidebar);

    return () => {
      window.removeEventListener('sidebar-toggle', toggleSidebar);
    };
  }, []);

  const screen: WorkbenchScreen = sessions.importing || holdImportScreen || !sessions.activeSession
    ? 'import'
    : (requestedScreen?.sessionId === sessions.activeSession.id
        && requestedScreen?.projectId === project.selectedProjectId
      ? requestedScreen.screen
      : sessions.activeSession.lastScreen);

  function navigate(next: WorkbenchScreen) {
    if (next !== 'import' && !sessions.activeSession?.importedSnapshot) return;
    if (next !== 'import' && sessions.activeSession) {
      setRequestedScreen({
        projectId: project.selectedProjectId,
        sessionId: sessions.activeSession.id,
        screen: next,
      });
    }
    if (next !== 'import' && sessions.activeSession) sessions.setLastScreen(sessions.activeSession.id, next);
  }

  if (project.isLoading) return <div className={styles.emptyState}>Loading Studio projects...</div>;
  if (project.error) return <div className={styles.emptyState}><p>{project.error.message}</p><button type="button" onClick={() => void project.retry()}>Retry</button></div>;
  if (!project.projects.length) return <div className={styles.emptyState}><h2>No Studio projects</h2><Link href="/projects">Create or join a project</Link></div>;
  if (sessions.isHydrating) return <div className={styles.emptyState}>Loading simulation sessions...</div>;
  if (sessions.persistenceStatus === 'load-error') return <div className={styles.emptyState}><p>{sessions.persistenceWarning}</p><button type="button" onClick={sessions.retryPersistence}>Retry</button></div>;

  const items = [{ id: 'import', label: 'Import' }, ...sessions.sessions.map((session) => ({ id: session.id, label: session.name }))];
  const headerLabels: Partial<Record<SimulationScreen, string>> = { characters: 'Configure characters', skills: 'Configure skills' };
  const workflow = STEPS.filter(({ id }) => id !== 'import').map((step) => ({ id: step.id, label: headerLabels[step.id] ?? step.label, disabled: !sessions.activeSession?.importedSnapshot }));
  const persistenceAction = sessions.persistenceStatus === 'conflict'
    ? { label: 'Load cloud version', run: sessions.loadCloudVersion }
    : sessions.persistenceStatus === 'unsaved'
      ? { label: 'Retry save', run: sessions.retryPersistence }
      : sessions.persistenceStatus === 'invalid'
        ? { label: 'Reset cloud state', run: sessions.resetStorage }
        : null;

  return <div className={styles.root} data-simulation-root>
    {sidebarHost ? createPortal(<SimulationSidebar items={items} activeId={screen === 'import' ? 'import' : sessions.activeSession?.id ?? 'import'} projectName={project.selectedProject?.name} projects={project.projects} projectId={project.selectedProjectId} onProjectSelect={project.selectProject} collapsed={collapsed} mobileOpen={mobileOpen} onCloseMobile={() => setMobileOpen(false)} onSelect={(id) => { if (id === 'import') { sessions.startFreshImport(); setHoldImportScreen(false); setRequestedScreen(null); } else { sessions.selectSession(id); setHoldImportScreen(false); setRequestedScreen(null); } }} />, sidebarHost) : null}
    {headerHost ? createPortal(<SimulationHeader title={screen === 'import' ? 'Import' : screen[0].toUpperCase() + screen.slice(1)} projectName={project.selectedProject?.name} steps={workflow} activeStepId={screen} onStepSelect={(id) => navigate(id as SimulationScreen)} />, headerHost) : null}
    <div className={styles.main}>
      <main className={styles.content}>
        {screen === 'import' ? <ImportScreen onImported={() => setHoldImportScreen(true)} onContinue={() => { setHoldImportScreen(false); navigate('characters'); }} /> : null}
        {screen === 'characters' ? <CharactersScreen onContinue={() => navigate('skills')} /> : null}
        {screen === 'skills' ? <SkillsScreen onContinue={() => navigate('progression')} /> : null}
        {screen === 'progression' ? <ProgressionScreen onContinue={() => navigate('battle')} /> : null}
        {screen === 'battle' ? <BattleScreen onContinue={() => navigate('progression')} /> : null}
      </main>
    </div>
    <SimulationToast visible={Boolean(sessions.persistenceWarning)} message={sessions.persistenceWarning ?? ''} tone="warning" actionLabel={persistenceAction?.label} onAction={persistenceAction?.run} />
  </div>;
}
