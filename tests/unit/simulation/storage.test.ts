import { describe, expect, it, jest } from '@jest/globals';

import {
  createSimulationStorageRepository,
  simulationStorageKey,
} from '@/lib/simulation/storage';
import type {
  ImportedSimulationSnapshot,
  SimulationStateV1,
} from '@/lib/simulation/types';

function snapshot(projectId = 'project: one'): ImportedSimulationSnapshot {
  return {
    sourceProjectId: projectId,
    catalog: {
      characters: [{ id: 'hero', name: 'Hero', cls: 'Guard', el: 'Earth', hp: 100, atk: 10, def: 8, spd: 5, mp: 20 }],
      skills: [{ id: 'quake', name: 'Quake', el: 'Earth', mp: 4, power: 20, cd: 1, kind: 'dmg', status: '' }],
      basic: { id: 'basic', name: 'Strike', el: 'Physical', mp: 0, power: 10, cd: 0, kind: 'dmg' },
    },
    levelRules: [{ level: 1, exp: 0, sp: 2 }],
    skillCostRules: [{ lv: 1, cost: 0 }],
    sourceLibraryIds: { characters: 'chars', skills: 'skills', level: 'levels', skillc: 'costs' },
    fieldMappings: {
      characters: { id: 'char-id' }, skills: { id: 'skill-id' }, level: { level: 'level' }, skillc: { lv: 'skill-level' },
    },
    importedAt: '2026-07-21T02:03:04.000Z',
  };
}

function state(projectId = 'project: one'): SimulationStateV1 {
  return {
    version: 1,
    activeSessionId: 'session-1',
    sessions: [{
      id: 'session-1', name: 'First run', importedSnapshot: snapshot(projectId),
      roster: [{ uid: 'unit-1', tmplId: 'hero', team: 'A' }],
      loadout: { 'unit-1': ['quake'] },
      skillLevels: { 'unit-1': { quake: 1 } },
      progression: { exp: { 'unit-1': 0 }, lv: { 'unit-1': 1 }, sp: { 'unit-1': 2 } },
      lastScreen: 'skills',
    }],
  };
}

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

describe('simulation storage repository', () => {
  it('uses encoded user and project scopes, including colons and spaces', () => {
    expect(simulationStorageKey('user: one', 'project: one')).toBe(
      'keco.simulation.sessions:v1:user%3A%20one:project%3A%20one',
    );
    expect(simulationStorageKey('user', 'a:b')).not.toBe(simulationStorageKey('user:a', 'b'));
  });

  it('round-trips a valid durable state without transient UI fields', () => {
    const storage = memoryStorage();
    const repository = createSimulationStorageRepository(storage);
    const expected = state();

    expect(repository.save('user: one', 'project: one', expected)).toEqual({ ok: true });
    const loaded = repository.load('user: one', 'project: one');
    expect(loaded).toEqual({ ok: true, state: expected });
    expect(loaded.ok && Object.isFrozen(loaded.state)).toBe(true);
    expect(loaded.ok && Object.isFrozen(loaded.state?.sessions[0].importedSnapshot?.catalog)).toBe(true);
    expect(loaded.ok && Object.isFrozen(loaded.state?.sessions[0].importedSnapshot?.catalog.characters[0])).toBe(true);
    expect(() => {
      if (loaded.ok && loaded.state?.sessions[0].importedSnapshot) {
        (loaded.state.sessions[0].importedSnapshot.catalog.characters[0] as { name: string }).name = 'Changed';
      }
    }).toThrow();
    const raw = storage.getItem(simulationStorageKey('user: one', 'project: one')) ?? '';
    const keys = (value: unknown): string[] => value && typeof value === 'object'
      ? Object.entries(value).flatMap(([key, child]) => [key, ...keys(child)])
      : [];
    expect(keys(JSON.parse(raw))).not.toEqual(expect.arrayContaining([
      'battle', 'animation', 'log', 'toast', 'menu', 'request', 'activeUid', 'progUid', 'importDraft',
    ]));
  });

  it('migrates valid v0 data by adding the default last screen', () => {
    const storage = memoryStorage();
    const old = structuredClone(state()) as unknown as Record<string, unknown>;
    old.version = 0;
    delete (old.sessions as Array<Record<string, unknown>>)[0].lastScreen;
    storage.setItem(simulationStorageKey('user', 'project: one'), JSON.stringify(old));

    const loaded = createSimulationStorageRepository(storage).load('user', 'project: one');
    expect(loaded).toEqual({
      ok: true,
      state: { ...state(), sessions: [{ ...state().sessions[0], lastScreen: 'characters' }] },
      migratedFrom: 0,
    });
    expect(loaded.ok && Object.isFrozen(loaded.state)).toBe(true);
    expect(loaded.ok && Object.isFrozen(loaded.state?.sessions[0].importedSnapshot?.fieldMappings.characters)).toBe(true);
    expect(() => {
      if (loaded.ok && loaded.state?.sessions[0].importedSnapshot) {
        (loaded.state.sessions[0].importedSnapshot.fieldMappings.characters as { id?: string }).id = 'Changed';
      }
    }).toThrow();
  });

  it.each([
    ['malformed JSON', '{', 'malformed'],
    ['invalid references', JSON.stringify({ ...state(), activeSessionId: 'missing' }), 'invalid_state'],
    ['unknown version', JSON.stringify({ ...state(), version: 99 }), 'unknown_version'],
  ])('returns a typed error for %s and preserves the stored value', (_label, raw, code) => {
    const storage = memoryStorage();
    const key = simulationStorageKey('user', 'project: one');
    storage.setItem(key, raw);

    expect(createSimulationStorageRepository(storage).load('user', 'project: one')).toMatchObject({
      ok: false, error: { code },
    });
    expect(storage.getItem(key)).toBe(raw);
  });

  it.each([
    ['getItem', 'read_failed'],
    ['setItem', 'write_failed'],
    ['removeItem', 'remove_failed'],
  ] as const)('classifies %s exceptions without throwing', (method, code) => {
    const storage = memoryStorage();
    storage[method] = jest.fn(() => { throw new Error('denied'); }) as never;
    const repository = createSimulationStorageRepository(storage);
    const result = method === 'getItem'
      ? repository.load('user', 'project: one')
      : method === 'setItem'
        ? repository.save('user', 'project: one', state())
        : repository.clear('user', 'project: one');
    expect(result).toMatchObject({ ok: false, error: { code } });
  });

  it('classifies unavailable storage for every operation', () => {
    const repository = createSimulationStorageRepository(null);
    expect(repository.load('user', 'project')).toMatchObject({ ok: false, error: { code: 'storage_unavailable' } });
    expect(repository.save('user', 'project', state())).toMatchObject({ ok: false, error: { code: 'storage_unavailable' } });
    expect(repository.clear('user', 'project')).toMatchObject({ ok: false, error: { code: 'storage_unavailable' } });
  });

  it('validates before save and does not overwrite existing data', () => {
    const storage = memoryStorage();
    const key = simulationStorageKey('user', 'project: one');
    storage.setItem(key, 'keep-me');
    const invalid = { ...state(), sessions: [{ ...state().sessions[0], battle: {} }] } as unknown as SimulationStateV1;

    expect(createSimulationStorageRepository(storage).save('user', 'project: one', invalid)).toMatchObject({
      ok: false, error: { code: 'invalid_state' },
    });
    expect(storage.getItem(key)).toBe('keep-me');
  });

  it('rejects invalid catalog, roster and map references', () => {
    const storage = memoryStorage();
    const repository = createSimulationStorageRepository(storage);
    const cases: SimulationStateV1[] = [
      { ...state(), sessions: [{ ...state().sessions[0], roster: [{ uid: 'unit-1', tmplId: 'missing', team: 'A' }] }] },
      { ...state(), sessions: [{ ...state().sessions[0], loadout: { 'unit-1': ['missing'] } }] },
      { ...state(), sessions: [{ ...state().sessions[0], skillLevels: { 'unit-1': { quake: 2, missing: 1 } } }] },
      { ...state(), sessions: [{ ...state().sessions[0], progression: { ...state().sessions[0].progression, exp: { orphan: 0 } } }] },
    ];
    for (const invalid of cases) {
      expect(repository.save('user', 'project: one', invalid)).toMatchObject({ ok: false, error: { code: 'invalid_state' } });
    }
  });

  it('clears only the requested user/project scope', () => {
    const storage = memoryStorage();
    const repository = createSimulationStorageRepository(storage);
    repository.save('user-a', 'project-a', state('project-a'));
    repository.save('user-a', 'project-b', state('project-b'));
    repository.save('user-b', 'project-a', state('project-a'));

    expect(repository.clear('user-a', 'project-a')).toEqual({ ok: true });
    expect(repository.load('user-a', 'project-a')).toEqual({ ok: true, state: null });
    expect(repository.load('user-a', 'project-b')).toMatchObject({ ok: true, state: expect.any(Object) });
    expect(repository.load('user-b', 'project-a')).toMatchObject({ ok: true, state: expect.any(Object) });
  });
});
