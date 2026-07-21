import { describe, expect, it } from '@jest/globals';

import { createFreshSimulationState, simulationSessionReducer } from '@/lib/simulation/sessionReducer';
import type { ImportedSimulationSnapshot, SimulationSession, SimulationStateV1 } from '@/lib/simulation/types';

function snapshot(id = 'hero'): ImportedSimulationSnapshot {
  return {
    sourceProjectId: 'project',
    catalog: {
      characters: [{ id, name: id, el: 'Fire', hp: 100, atk: 10, def: 10, spd: 10, mp: 10 }],
      skills: [{ id: 'fire', name: 'Fire', el: 'Fire', mp: 1, power: 10, cd: 0, kind: 'dmg' }],
      basic: { id: 'basic', name: 'Strike', el: 'Physical', mp: 0, power: 1, cd: 0, kind: 'dmg' },
    },
    levelRules: [{ level: 1, exp: 0, sp: 2 }], skillCostRules: [{ lv: 1, cost: 0 }],
    sourceLibraryIds: { characters: 'c', skills: 's', level: 'l', skillc: 'sc' },
    fieldMappings: { characters: {}, skills: {}, level: {}, skillc: {} },
    importedAt: '2026-07-21T00:00:00.000Z',
  };
}

function session(id: string): SimulationSession {
  return { id, name: id, importedSnapshot: snapshot(), roster: [], loadout: {}, skillLevels: {}, progression: { exp: {}, lv: {}, sp: {} }, lastScreen: 'characters' };
}

function state(): SimulationStateV1 {
  return { version: 1, activeSessionId: 'one', sessions: [session('one'), session('two')] };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

describe('simulation session reducer', () => {
  it('creates a fresh project state and fully replaces state on project changes', () => {
    expect(createFreshSimulationState()).toEqual({ version: 1, activeSessionId: null, sessions: [] });
    const replacement = { version: 1, activeSessionId: 'new', sessions: [session('new')] } as const;
    expect(simulationSessionReducer(state(), { type: 'PROJECT_CHANGED', state: replacement })).toBe(replacement);
    expect(simulationSessionReducer(state(), { type: 'PROJECT_CHANGED' })).toEqual(createFreshSimulationState());
  });

  it('creates and selects sessions while duplicate or unknown ids are no-ops', () => {
    const original = state();
    const created = simulationSessionReducer(original, { type: 'SESSION_CREATED', session: session('three') });
    expect(created.sessions.map(({ id }) => id)).toEqual(['one', 'two', 'three']);
    expect(created.activeSessionId).toBe('three');
    expect(simulationSessionReducer(created, { type: 'SESSION_CREATED', session: session('three') })).toBe(created);
    expect(simulationSessionReducer(created, { type: 'ACTIVE_SESSION_SELECTED', sessionId: 'missing' })).toBe(created);
    expect(simulationSessionReducer(created, { type: 'ACTIVE_SESSION_SELECTED', sessionId: 'two' }).activeSessionId).toBe('two');
  });

  it('atomically replaces a reimport and resets all derived session data', () => {
    const original = state();
    original.sessions[0] = {
      ...original.sessions[0], roster: [{ uid: 'u', tmplId: 'hero', team: 'A' }], loadout: { u: ['fire'] },
      skillLevels: { u: { fire: 3 } }, progression: { exp: { u: 9 }, lv: { u: 2 }, sp: { u: 0 } },
    };
    const imported = snapshot('replacement');
    const result = simulationSessionReducer(original, { type: 'IMPORT_COMMITTED', sessionId: 'one', snapshot: imported });
    expect(result.sessions[0]).toMatchObject({ importedSnapshot: imported, roster: [], loadout: {}, skillLevels: {}, progression: { exp: {}, lv: {}, sp: {} } });
    expect(result.sessions[1]).toBe(original.sessions[1]);
    expect(simulationSessionReducer(original, { type: 'IMPORT_COMMITTED', sessionId: 'missing', snapshot: imported })).toBe(original);
  });

  it('updates roster and initializes new units while pruning all orphaned maps', () => {
    const original = state();
    original.sessions[0] = {
      ...original.sessions[0],
      roster: [{ uid: 'old', tmplId: 'hero', team: 'A' }],
      loadout: { old: ['fire'], orphan: ['fire'] }, skillLevels: { old: { fire: 2 }, orphan: {} },
      progression: { exp: { old: 9, orphan: 1 }, lv: { old: 2, orphan: 1 }, sp: { old: 0, orphan: 2 } },
    };
    const result = simulationSessionReducer(original, {
      type: 'ROSTER_UPDATED', sessionId: 'one', roster: [{ uid: 'new', tmplId: 'hero', team: 'B' }],
    });
    expect(result.sessions[0]).toMatchObject({
      roster: [{ uid: 'new', tmplId: 'hero', team: 'B' }], loadout: { new: [] }, skillLevels: { new: {} },
      progression: { exp: { new: 0 }, lv: { new: 1 }, sp: { new: 2 } },
    });
    expect(result.sessions[1]).toBe(original.sessions[1]);
  });

  it('applies skill, progression and screen updates to one known session', () => {
    const original = state();
    const rostered = simulationSessionReducer(original, { type: 'ROSTER_UPDATED', sessionId: 'one', roster: [{ uid: 'u', tmplId: 'hero', team: 'A' }] });
    const skilled = simulationSessionReducer(rostered, { type: 'SKILL_UPDATED', sessionId: 'one', uid: 'u', loadout: ['fire'], skillLevels: { fire: 2 } });
    expect(skilled.sessions[0].loadout.u).toEqual(['fire']);
    expect(skilled.sessions[0].skillLevels.u).toEqual({ fire: 2 });
    const progressed = simulationSessionReducer(skilled, { type: 'PROGRESSION_UPDATED', sessionId: 'one', uid: 'u', exp: 5, lv: 2, sp: 1 });
    expect(progressed.sessions[0].progression).toEqual({ exp: { u: 5 }, lv: { u: 2 }, sp: { u: 1 } });
    const screened = simulationSessionReducer(progressed, { type: 'LAST_SCREEN_CHANGED', sessionId: 'one', lastScreen: 'battle' });
    expect(screened.sessions[0].lastScreen).toBe('battle');
    expect(screened.sessions[1]).toBe(original.sessions[1]);
  });

  it('does not mutate deeply frozen inputs and preserves untouched session references', () => {
    const original = deepFreeze(state());
    const result = simulationSessionReducer(original, { type: 'LAST_SCREEN_CHANGED', sessionId: 'one', lastScreen: 'skills' });
    expect(result).not.toBe(original);
    expect(result.sessions[0]).not.toBe(original.sessions[0]);
    expect(result.sessions[1]).toBe(original.sessions[1]);
    expect(original.sessions[0].lastScreen).toBe('characters');
  });

  it.each(['ROSTER_UPDATED', 'SKILL_UPDATED', 'PROGRESSION_UPDATED', 'LAST_SCREEN_CHANGED'] as const)(
    'treats unknown sessions as no-ops for %s',
    (type) => {
      const original = state();
      const action = type === 'ROSTER_UPDATED'
        ? { type, sessionId: 'missing', roster: [] as const }
        : type === 'SKILL_UPDATED'
          ? { type, sessionId: 'missing', uid: 'u', loadout: [], skillLevels: {} }
          : type === 'PROGRESSION_UPDATED'
            ? { type, sessionId: 'missing', uid: 'u', exp: 0, lv: 1, sp: 2 }
            : { type, sessionId: 'missing', lastScreen: 'battle' as const };
      expect(simulationSessionReducer(original, action)).toBe(original);
    },
  );
});
