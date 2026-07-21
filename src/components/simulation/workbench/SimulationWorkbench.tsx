'use client';

import Link from 'next/link';
import { useState } from 'react';
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

export function SimulationWorkbench() {
  const project = useSimulationProject();
  const sessions = useSimulationSession();
  const [requestedScreen, setRequestedScreen] = useState<SimulationScreen | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const screen: WorkbenchScreen = sessions.importing || !sessions.activeSession
    ? 'import'
    : (requestedScreen ?? sessions.activeSession.lastScreen);

  function navigate(next: WorkbenchScreen) {
    if (next !== 'import' && !sessions.activeSession?.importedSnapshot) return;
    if (next !== 'import') setRequestedScreen(next);
    if (next !== 'import' && sessions.activeSession) sessions.setLastScreen(sessions.activeSession.id, next);
  }

  if (project.isLoading) return <div className={styles.emptyState}>Loading Studio projects...</div>;
  if (project.error) return <div className={styles.emptyState}><p>{project.error.message}</p><button type="button" onClick={() => void project.retry()}>Retry</button></div>;
  if (!project.projects.length) return <div className={styles.emptyState}><h2>No Studio projects</h2><Link href="/projects">Create or join a project</Link></div>;

  const items = [{ id: 'import', label: 'Import', description: 'Bind Studio libraries' }, ...sessions.sessions.map((session) => ({ id: session.id, label: session.name, description: session.importedSnapshot ? 'Ready to simulate' : 'Import required' }))];
  const workflow = STEPS.filter(({ id }) => id !== 'import').map((step) => ({ id: step.id, label: step.label, disabled: !sessions.activeSession?.importedSnapshot }));

  return <div className={styles.root} data-simulation-root>
    <SimulationSidebar items={items} activeId={screen === 'import' ? 'import' : sessions.activeSession?.id ?? 'import'} projectName={project.selectedProject?.name} collapsed={collapsed} mobileOpen={mobileOpen} onToggleCollapsed={() => setCollapsed((value) => !value)} onCloseMobile={() => setMobileOpen(false)} onSelect={(id) => { if (id === 'import') { sessions.startFreshImport(); setRequestedScreen(null); } else { sessions.selectSession(id); setRequestedScreen(sessions.sessions.find((session) => session.id === id)?.lastScreen ?? 'characters'); } }} />
    <div className={styles.main}>
      <SimulationHeader title={screen === 'import' ? 'Import' : screen[0].toUpperCase() + screen.slice(1)} steps={workflow} activeStepId={screen} onStepSelect={(id) => navigate(id as SimulationScreen)} />
      <main className={styles.content}>
        <div className={styles.projectSwitcher}><label>Studio project<select value={project.selectedProjectId ?? ''} onChange={(event) => project.selectProject(event.target.value)}>{project.projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div>
        {screen === 'import' ? <ImportScreen /> : null}
        {screen === 'characters' ? <CharactersScreen onContinue={() => navigate('skills')} /> : null}
        {screen === 'skills' ? <SkillsScreen onContinue={() => navigate('progression')} /> : null}
        {screen === 'progression' ? <ProgressionScreen onContinue={() => navigate('battle')} /> : null}
        {screen === 'battle' ? <BattleScreen /> : null}
      </main>
    </div>
    <SimulationToast visible={Boolean(sessions.persistenceWarning)} message={sessions.persistenceWarning ?? ''} tone="warning" onDismiss={sessions.storageBlocked ? sessions.resetStorage : undefined} />
  </div>;
}
