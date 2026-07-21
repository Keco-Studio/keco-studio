import type {
  ImportedSimulationSnapshot,
  RosterEntry,
  SimulationScreen,
  SimulationSession,
  SimulationStateV1,
} from './types';

export type SimulationSessionAction =
  | { readonly type: 'PROJECT_CHANGED'; readonly state?: SimulationStateV1 }
  | { readonly type: 'SESSION_CREATED'; readonly session: SimulationSession }
  | { readonly type: 'ACTIVE_SESSION_SELECTED'; readonly sessionId: string }
  | { readonly type: 'IMPORT_COMMITTED'; readonly sessionId: string; readonly snapshot: ImportedSimulationSnapshot }
  | { readonly type: 'ROSTER_UPDATED'; readonly sessionId: string; readonly roster: readonly RosterEntry[] }
  | {
      readonly type: 'SKILL_UPDATED';
      readonly sessionId: string;
      readonly uid: string;
      readonly loadout: readonly string[];
      readonly skillLevels: Readonly<Record<string, number>>;
    }
  | {
      readonly type: 'PROGRESSION_UPDATED';
      readonly sessionId: string;
      readonly uid: string;
      readonly exp: number;
      readonly lv: number;
      readonly sp: number;
    }
  | { readonly type: 'LAST_SCREEN_CHANGED'; readonly sessionId: string; readonly lastScreen: SimulationScreen };

export function createFreshSimulationState(): SimulationStateV1 {
  return { version: 1, activeSessionId: null, sessions: [] };
}

function updateSession(
  state: SimulationStateV1,
  sessionId: string,
  update: (session: SimulationSession) => SimulationSession,
): SimulationStateV1 {
  const index = state.sessions.findIndex((session) => session.id === sessionId);
  if (index < 0) return state;
  const sessions = [...state.sessions];
  sessions[index] = update(state.sessions[index]);
  return { ...state, sessions };
}

function pickMap<T>(source: Readonly<Record<string, T>>, uids: ReadonlySet<string>): Record<string, T> {
  return Object.fromEntries(Object.entries(source).filter(([uid]) => uids.has(uid)));
}

export function simulationSessionReducer(
  state: SimulationStateV1,
  action: SimulationSessionAction,
): SimulationStateV1 {
  switch (action.type) {
    case 'PROJECT_CHANGED':
      return action.state ?? createFreshSimulationState();
    case 'SESSION_CREATED':
      if (state.sessions.some((session) => session.id === action.session.id)) return state;
      return { ...state, activeSessionId: action.session.id, sessions: [...state.sessions, action.session] };
    case 'ACTIVE_SESSION_SELECTED':
      if (!state.sessions.some((session) => session.id === action.sessionId)) return state;
      return state.activeSessionId === action.sessionId ? state : { ...state, activeSessionId: action.sessionId };
    case 'IMPORT_COMMITTED':
      return updateSession(state, action.sessionId, (session) => ({
        ...session,
        importedSnapshot: action.snapshot,
        roster: [],
        loadout: {},
        skillLevels: {},
        progression: { exp: {}, lv: {}, sp: {} },
      }));
    case 'ROSTER_UPDATED':
      return updateSession(state, action.sessionId, (session) => {
        const uids = new Set(action.roster.map(({ uid }) => uid));
        const loadout = pickMap(session.loadout, uids);
        const skillLevels = pickMap(session.skillLevels, uids);
        const exp = pickMap(session.progression.exp, uids);
        const lv = pickMap(session.progression.lv, uids);
        const sp = pickMap(session.progression.sp, uids);
        for (const { uid } of action.roster) {
          loadout[uid] ??= [];
          skillLevels[uid] ??= {};
          exp[uid] ??= 0;
          lv[uid] ??= 1;
          sp[uid] ??= 2;
        }
        return {
          ...session,
          roster: [...action.roster],
          loadout,
          skillLevels,
          progression: { exp, lv, sp },
        };
      });
    case 'SKILL_UPDATED':
      return updateSession(state, action.sessionId, (session) => ({
        ...session,
        loadout: { ...session.loadout, [action.uid]: [...action.loadout] },
        skillLevels: { ...session.skillLevels, [action.uid]: { ...action.skillLevels } },
      }));
    case 'PROGRESSION_UPDATED':
      return updateSession(state, action.sessionId, (session) => ({
        ...session,
        progression: {
          exp: { ...session.progression.exp, [action.uid]: action.exp },
          lv: { ...session.progression.lv, [action.uid]: action.lv },
          sp: { ...session.progression.sp, [action.uid]: action.sp },
        },
      }));
    case 'LAST_SCREEN_CHANGED':
      return updateSession(state, action.sessionId, (session) => (
        session.lastScreen === action.lastScreen ? session : { ...session, lastScreen: action.lastScreen }
      ));
  }
}
