'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useState } from 'react';
import { useAuth } from '@/lib/contexts/AuthContext';
import { createFreshSimulationState, simulationSessionReducer } from './sessionReducer';
import { createSimulationStorageRepository } from './storage';
import type { ImportedSimulationSnapshot, RosterEntry, SimulationScreen, SimulationSession, SimulationStateV1 } from './types';
import { useSimulationProject } from './SimulationProjectProvider';

type SessionContextValue = {
  state: SimulationStateV1;
  sessions: SimulationSession[];
  activeSession: SimulationSession | null;
  importing: boolean;
  persistenceWarning: string | null;
  storageBlocked: boolean;
  startFreshImport: () => void;
  commitImport: (snapshot: ImportedSimulationSnapshot, name: string, sessionId?: string) => void;
  selectSession: (sessionId: string) => void;
  updateRoster: (sessionId: string, roster: readonly RosterEntry[]) => void;
  updateSkills: (sessionId: string, uid: string, loadout: readonly string[], skillLevels: Readonly<Record<string, number>>) => void;
  updateProgression: (sessionId: string, uid: string, exp: number, lv: number, sp: number) => void;
  setLastScreen: (sessionId: string, lastScreen: SimulationScreen) => void;
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
  const { userProfile } = useAuth();
  const userId = userProfile?.id;
  const { selectedProjectId } = useSimulationProject();
  const [state, dispatch] = useReducer(simulationSessionReducer, undefined, createFreshSimulationState);
  const [importing, setImporting] = useState(false);
  const [hydratedNamespace, setHydratedNamespace] = useState<string | null>(null);
  const [blockedNamespace, setBlockedNamespace] = useState<string | null>(null);
  const [persistenceWarning, setPersistenceWarning] = useState<string | null>(null);
  const repository = useMemo(() => createSimulationStorageRepository(typeof window === 'undefined' ? null : window.localStorage), []);
  const namespace = userId && selectedProjectId ? userId + ':' + selectedProjectId : null;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setImporting(false);
      setPersistenceWarning(null);
      if (!namespace || !userId || !selectedProjectId) {
        dispatch({ type: 'PROJECT_CHANGED' });
        setHydratedNamespace(null);
        setBlockedNamespace(null);
        return;
      }
      const loaded = repository.load(userId, selectedProjectId);
      if ('error' in loaded) {
        dispatch({ type: 'PROJECT_CHANGED' });
        setHydratedNamespace(null);
        setBlockedNamespace(namespace);
        setPersistenceWarning(loaded.error.message);
        return;
      }
      dispatch({ type: 'PROJECT_CHANGED', state: loaded.state ?? createFreshSimulationState() });
      setBlockedNamespace(null);
      setHydratedNamespace(namespace);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [namespace, repository, selectedProjectId, userId]);

  useEffect(() => {
    if (!namespace || hydratedNamespace !== namespace || blockedNamespace === namespace) return;
    if (!userId || !selectedProjectId) return;
    const timer = window.setTimeout(() => {
      const saved = repository.save(userId, selectedProjectId, state);
      setPersistenceWarning('error' in saved ? saved.error.message : null);
    }, 150);
    return () => window.clearTimeout(timer);
  }, [blockedNamespace, hydratedNamespace, namespace, repository, selectedProjectId, state, userId]);

  const commitImport = useCallback((snapshot: ImportedSimulationSnapshot, name: string, sessionId?: string) => {
    const targetId = sessionId ?? state.activeSessionId;
    if (targetId && state.sessions.some(({ id }) => id === targetId)) {
      dispatch({ type: 'IMPORT_COMMITTED', sessionId: targetId, snapshot });
    } else {
      dispatch({ type: 'SESSION_CREATED', session: newSession(snapshot, name) });
    }
    setImporting(false);
  }, [state.activeSessionId, state.sessions]);

  const selectSession = useCallback((sessionId: string) => {
    dispatch({ type: 'ACTIVE_SESSION_SELECTED', sessionId });
    setImporting(false);
  }, []);

  const resetStorage = useCallback(() => {
    if (!namespace || !userId || !selectedProjectId) return;
    const cleared = repository.clear(userId, selectedProjectId);
    if ('error' in cleared) {
      setPersistenceWarning(cleared.error.message);
      return;
    }
    dispatch({ type: 'PROJECT_CHANGED' });
    setBlockedNamespace(null);
    setHydratedNamespace(namespace);
    setPersistenceWarning(null);
  }, [namespace, repository, selectedProjectId, userId]);

  const activeSession = state.sessions.find(({ id }) => id === state.activeSessionId) ?? null;
  const value = useMemo<SessionContextValue>(() => ({
    state,
    sessions: state.sessions,
    activeSession,
    importing,
    persistenceWarning,
    storageBlocked: Boolean(namespace && blockedNamespace === namespace),
    startFreshImport: () => setImporting(true),
    commitImport,
    selectSession,
    updateRoster: (sessionId, roster) => dispatch({ type: 'ROSTER_UPDATED', sessionId, roster }),
    updateSkills: (sessionId, uid, loadout, skillLevels) => dispatch({ type: 'SKILL_UPDATED', sessionId, uid, loadout, skillLevels }),
    updateProgression: (sessionId, uid, exp, lv, sp) => dispatch({ type: 'PROGRESSION_UPDATED', sessionId, uid, exp, lv, sp }),
    setLastScreen: (sessionId, lastScreen) => dispatch({ type: 'LAST_SCREEN_CHANGED', sessionId, lastScreen }),
    resetStorage,
  }), [activeSession, blockedNamespace, commitImport, importing, namespace, persistenceWarning, resetStorage, selectSession, state]);

  return <SimulationSessionContext.Provider value={value}>{children}</SimulationSessionContext.Provider>;
}

export function useSimulationSession() {
  const value = useContext(SimulationSessionContext);
  if (!value) throw new Error('useSimulationSession must be used within SimulationSessionProvider.');
  return value;
}
