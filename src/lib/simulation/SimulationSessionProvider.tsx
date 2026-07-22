'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useSupabase } from '@/lib/SupabaseContext';
import { useAuth } from '@/lib/contexts/AuthContext';
import { createFreshSimulationState, simulationSessionReducer } from './sessionReducer';
import { SimulationSaveQueue } from './SimulationSaveQueue';
import { createSimulationStorageRepository } from './storage';
import type { ImportedSimulationSnapshot, RosterEntry, SimulationScreen, SimulationSession, SimulationStateV1 } from './types';
import { useSimulationProject } from './SimulationProjectProvider';

export type SimulationPersistenceStatus = 'hydrating' | 'ready' | 'unsaved' | 'conflict' | 'load-error' | 'invalid';

type SessionContextValue = {
  state: SimulationStateV1;
  sessions: SimulationSession[];
  activeSession: SimulationSession | null;
  importing: boolean;
  isHydrating: boolean;
  persistenceStatus: SimulationPersistenceStatus;
  persistenceWarning: string | null;
  startFreshImport: () => void;
  commitImport: (snapshot: ImportedSimulationSnapshot, name: string, sessionId?: string) => void;
  selectSession: (sessionId: string) => void;
  updateRoster: (sessionId: string, roster: readonly RosterEntry[]) => void;
  updateSkills: (sessionId: string, uid: string, loadout: readonly string[], skillLevels: Readonly<Record<string, number>>) => void;
  updateProgression: (sessionId: string, uid: string, exp: number, lv: number, sp: number) => void;
  setLastScreen: (sessionId: string, lastScreen: SimulationScreen) => void;
  retryPersistence: () => void;
  loadCloudVersion: () => void;
  resetStorage: () => void;
};

const SimulationSessionContext = createContext<SessionContextValue | null>(null);

function newSession(snapshot: ImportedSimulationSnapshot, name: string): SimulationSession {
  const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'sim-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  return {
    id,
    name: name.trim() || 'New simulator',
    importedSnapshot: snapshot,
    roster: [],
    loadout: {},
    skillLevels: {},
    progression: { exp: {}, lv: {}, sp: {} },
    lastScreen: 'characters',
  };
}

export function SimulationSessionProvider({ children }: { children: React.ReactNode }) {
  const supabase = useSupabase();
  const { userProfile } = useAuth();
  const userId = userProfile?.id;
  const { selectedProjectId } = useSimulationProject();
  const [state, dispatch] = useReducer(simulationSessionReducer, undefined, createFreshSimulationState);
  const [importing, setImporting] = useState(false);
  const [persistenceStatus, setPersistenceStatus] = useState<SimulationPersistenceStatus>('hydrating');
  const [persistenceWarning, setPersistenceWarning] = useState<string | null>(null);
  const repository = useMemo(() => createSimulationStorageRepository(supabase), [supabase]);
  const namespace = userId && selectedProjectId ? userId + ':' + selectedProjectId : null;
  const queueRef = useRef<SimulationSaveQueue | null>(null);
  const requestGenerationRef = useRef(0);
  const invalidRevisionRef = useRef<number | null>(null);
  const lastQueuedStateRef = useRef<SimulationStateV1 | null>(null);

  const installQueue = useCallback((
    projectId: string,
    generation: number,
    revision: number,
    baseline: SimulationStateV1,
  ) => {
    lastQueuedStateRef.current = baseline;
    const queue = new SimulationSaveQueue({
      revision,
      save: (expectedRevision, pendingState) => repository.save(projectId, expectedRevision, pendingState),
      onSaved: (_nextRevision, dirty) => {
        if (requestGenerationRef.current !== generation) return;
        setPersistenceStatus('ready');
        if (!dirty) setPersistenceWarning(null);
      },
      onUnsaved: (error) => {
        if (requestGenerationRef.current !== generation) return;
        setPersistenceStatus('unsaved');
        setPersistenceWarning(error.message);
      },
      onConflict: () => {
        if (requestGenerationRef.current !== generation) return;
        setPersistenceStatus('conflict');
        setPersistenceWarning('Cloud simulation state is newer. Load the cloud version to continue saving.');
      },
    });
    queueRef.current = queue;
  }, [repository]);

  const hydrate = useCallback(async () => {
    const generation = ++requestGenerationRef.current;
    const queue = queueRef.current;
    if (queue) queue.stop();
    queueRef.current = null;
    invalidRevisionRef.current = null;
    lastQueuedStateRef.current = null;
    setImporting(false);
    setPersistenceWarning(null);
    dispatch({ type: 'PROJECT_CHANGED' });

    if (!namespace || !selectedProjectId) {
      setPersistenceStatus('ready');
      return;
    }

    setPersistenceStatus('hydrating');
    const loaded = await repository.load(selectedProjectId);
    if (generation !== requestGenerationRef.current) return;
    if ('error' in loaded) {
      invalidRevisionRef.current = loaded.error.observedRevision ?? null;
      setPersistenceStatus(loaded.error.observedRevision === undefined ? 'load-error' : 'invalid');
      setPersistenceWarning(loaded.error.message);
      return;
    }

    const nextState = loaded.state ?? createFreshSimulationState();
    dispatch({ type: 'PROJECT_CHANGED', state: nextState });
    installQueue(selectedProjectId, generation, loaded.revision, nextState);
    setPersistenceStatus('ready');
  }, [installQueue, namespace, repository, selectedProjectId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void hydrate(), 0);
    return () => {
      window.clearTimeout(timer);
      requestGenerationRef.current += 1;
      const queue = queueRef.current;
      if (queue) queue.stop();
      queueRef.current = null;
    };
  }, [hydrate]);

  useEffect(() => {
    if (persistenceStatus !== 'ready' && persistenceStatus !== 'unsaved') return;
    if (!queueRef.current || lastQueuedStateRef.current === state) return;
    const timer = window.setTimeout(() => {
      lastQueuedStateRef.current = state;
      queueRef.current?.enqueue(state);
    }, 150);
    return () => window.clearTimeout(timer);
  }, [persistenceStatus, state]);

  const commitImport = useCallback((snapshot: ImportedSimulationSnapshot, name: string, sessionId?: string) => {
    if (!selectedProjectId || snapshot.sourceProjectId !== selectedProjectId) {
      setPersistenceWarning('Imported simulation data does not belong to the selected project.');
      return;
    }
    const targetId = sessionId;
    if (targetId && state.sessions.some(({ id }) => id === targetId)) {
      dispatch({ type: 'IMPORT_COMMITTED', sessionId: targetId, snapshot });
    } else {
      dispatch({ type: 'SESSION_CREATED', session: newSession(snapshot, name) });
    }
    setImporting(false);
  }, [selectedProjectId, state.sessions]);

  const selectSession = useCallback((sessionId: string) => {
    dispatch({ type: 'ACTIVE_SESSION_SELECTED', sessionId });
    setImporting(false);
  }, []);

  const retryPersistence = useCallback(() => {
    if (persistenceStatus === 'load-error') {
      void hydrate();
      return;
    }
    if (persistenceStatus === 'unsaved') queueRef.current?.retry();
  }, [hydrate, persistenceStatus]);

  const loadCloudVersion = useCallback(() => {
    if (persistenceStatus === 'conflict') void hydrate();
  }, [hydrate, persistenceStatus]);

  const resetStorage = useCallback(async () => {
    if (!selectedProjectId || !namespace) return;
    const generation = requestGenerationRef.current;
    const revision = invalidRevisionRef.current ?? queueRef.current?.getRevision();
    if (revision === undefined) return;
    const queue = queueRef.current;
    if (queue) queue.stop();
    const cleared = await repository.clear(selectedProjectId, revision);
    if (generation !== requestGenerationRef.current) return;
    if ('error' in cleared) {
      setPersistenceStatus(cleared.error.code === 'conflict' ? 'conflict' : 'unsaved');
      setPersistenceWarning(cleared.error.message);
      return;
    }
    const fresh = createFreshSimulationState();
    invalidRevisionRef.current = null;
    dispatch({ type: 'PROJECT_CHANGED', state: fresh });
    installQueue(selectedProjectId, generation, 0, fresh);
    setPersistenceStatus('ready');
    setPersistenceWarning(null);
  }, [installQueue, namespace, repository, selectedProjectId]);

  const activeSession = state.sessions.find(({ id }) => id === state.activeSessionId) ?? null;
  const value = useMemo<SessionContextValue>(() => ({
    state,
    sessions: state.sessions,
    activeSession,
    importing,
    isHydrating: persistenceStatus === 'hydrating',
    persistenceStatus,
    persistenceWarning,
    startFreshImport: () => setImporting(true),
    commitImport,
    selectSession,
    updateRoster: (sessionId, roster) => dispatch({ type: 'ROSTER_UPDATED', sessionId, roster }),
    updateSkills: (sessionId, uid, loadout, skillLevels) => dispatch({ type: 'SKILL_UPDATED', sessionId, uid, loadout, skillLevels }),
    updateProgression: (sessionId, uid, exp, lv, sp) => dispatch({ type: 'PROGRESSION_UPDATED', sessionId, uid, exp, lv, sp }),
    setLastScreen: (sessionId, lastScreen) => dispatch({ type: 'LAST_SCREEN_CHANGED', sessionId, lastScreen }),
    retryPersistence,
    loadCloudVersion,
    resetStorage: () => void resetStorage(),
  }), [activeSession, commitImport, importing, loadCloudVersion, persistenceStatus, persistenceWarning, resetStorage, retryPersistence, selectSession, state]);

  return <SimulationSessionContext.Provider value={value}>{children}</SimulationSessionContext.Provider>;
}

export function useSimulationSession() {
  const value = useContext(SimulationSessionContext);
  if (!value) throw new Error('useSimulationSession must be used within SimulationSessionProvider.');
  return value;
}
