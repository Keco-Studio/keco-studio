import { describe, expect, it, jest } from '@jest/globals';

import { createSimulationStorageRepository } from '@/lib/simulation/storage';
import type { ImportedSimulationSnapshot, SimulationStateV1 } from '@/lib/simulation/types';

function snapshot(projectId = 'project-1'): ImportedSimulationSnapshot {
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

function state(projectId = 'project-1'): SimulationStateV1 {
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

type DbResult = { data: unknown; error: { code?: string; message?: string } | null };

function client(loadResult: DbResult, rpcResult: DbResult = { data: null, error: null }) {
  const maybeSingle = jest.fn(async () => loadResult);
  const eq = jest.fn(() => ({ maybeSingle }));
  const select = jest.fn(() => ({ eq }));
  const from = jest.fn(() => ({ select }));
  const rpc = jest.fn(async () => rpcResult);
  return { value: { from, rpc }, from, select, eq, maybeSingle, rpc };
}

describe('Supabase simulation storage repository', () => {
  it('loads an absent row as revision zero without sending a user id', async () => {
    const mock = client({ data: null, error: null });
    const repository = createSimulationStorageRepository(mock.value as never);

    await expect(repository.load('project-1')).resolves.toEqual({ ok: true, state: null, revision: 0 });
    expect(mock.from).toHaveBeenCalledWith('simulation_states');
    expect(mock.select).toHaveBeenCalledWith('state_version,state,revision');
    expect(mock.eq).toHaveBeenCalledWith('project_id', 'project-1');
    expect(JSON.stringify(mock.from.mock.calls)).not.toContain('user_id');
  });

  it('validates and deeply freezes a cloud snapshot', async () => {
    const expected = state();
    const mock = client({ data: { state_version: 1, state: expected, revision: 7 }, error: null });
    const loaded = await createSimulationStorageRepository(mock.value as never).load('project-1');

    expect(loaded).toEqual({ ok: true, state: expected, revision: 7 });
    expect(loaded.ok && Object.isFrozen(loaded.state)).toBe(true);
    expect(loaded.ok && Object.isFrozen(loaded.state?.sessions[0].importedSnapshot?.catalog.characters[0])).toBe(true);
  });

  it.each([
    ['unsupported database version', { state_version: 0, state: { version: 0 }, revision: 4 }, 'unknown_version'],
    ['invalid state', { state_version: 1, state: { ...state(), activeSessionId: 'missing' }, revision: 5 }, 'invalid_state'],
    ['wrong project', { state_version: 1, state: state('another-project'), revision: 6 }, 'invalid_state'],
    ['invalid revision', { state_version: 1, state: state(), revision: -1 }, 'invalid_state'],
  ])('rejects %s and preserves the observed revision when available', async (_label, row, code) => {
    const loaded = await createSimulationStorageRepository(client({ data: row, error: null }).value as never).load('project-1');
    expect(loaded).toMatchObject({ ok: false, error: { code } });
    if (row.revision >= 0) expect(loaded).toMatchObject({ error: { observedRevision: row.revision } });
  });

  it('classifies read and authorization failures without exposing backend messages', async () => {
    const denied = await createSimulationStorageRepository(client({ data: null, error: { code: '42501', message: 'secret policy detail' } }).value as never).load('project-1');
    expect(denied).toEqual({ ok: false, error: { code: 'unauthorized', message: 'Simulation state is not accessible.' } });

    const failed = await createSimulationStorageRepository(client({ data: null, error: { code: '500', message: 'private host' } }).value as never).load('project-1');
    expect(failed).toEqual({ ok: false, error: { code: 'read_failed', message: 'Simulation state could not be read.' } });
  });

  it('validates before save and calls the revision-aware RPC', async () => {
    const mock = client({ data: null, error: null }, { data: [{ status: 'saved', revision: 5 }], error: null });
    const repository = createSimulationStorageRepository(mock.value as never);

    await expect(repository.save('project-1', 4, state())).resolves.toEqual({ ok: true, revision: 5 });
    expect(mock.rpc).toHaveBeenCalledWith('save_simulation_state', {
      p_project_id: 'project-1', p_expected_revision: 4, p_state_version: 1, p_state: state(),
    });
    expect(JSON.stringify(mock.rpc.mock.calls)).not.toContain('user_id');
  });

  it('does not call Supabase for invalid state', async () => {
    const mock = client({ data: null, error: null });
    const invalid = { ...state(), sessions: [{ ...state().sessions[0], battle: {} }] } as unknown as SimulationStateV1;
    await expect(createSimulationStorageRepository(mock.value as never).save('project-1', 0, invalid))
      .resolves.toMatchObject({ ok: false, error: { code: 'invalid_state' } });
    expect(mock.rpc).not.toHaveBeenCalled();
  });

  it('classifies save conflicts and backend failures', async () => {
    const conflict = client({ data: null, error: null }, { data: [{ status: 'conflict', revision: null }], error: null });
    await expect(createSimulationStorageRepository(conflict.value as never).save('project-1', 2, state()))
      .resolves.toMatchObject({ ok: false, error: { code: 'conflict' } });

    const failed = client({ data: null, error: null }, { data: null, error: { code: '500', message: 'private detail' } });
    await expect(createSimulationStorageRepository(failed.value as never).save('project-1', 2, state()))
      .resolves.toEqual({ ok: false, error: { code: 'write_failed', message: 'Simulation state could not be saved.' } });
  });

  it('clears through the revision-aware RPC and classifies conflicts', async () => {
    const saved = client({ data: null, error: null }, { data: [{ status: 'reset', revision: null }], error: null });
    await expect(createSimulationStorageRepository(saved.value as never).clear('project-1', 4))
      .resolves.toEqual({ ok: true });
    expect(saved.rpc).toHaveBeenCalledWith('reset_simulation_state', { p_project_id: 'project-1', p_expected_revision: 4 });

    const conflict = client({ data: null, error: null }, { data: [{ status: 'conflict', revision: null }], error: null });
    await expect(createSimulationStorageRepository(conflict.value as never).clear('project-1', 4))
      .resolves.toMatchObject({ ok: false, error: { code: 'conflict' } });
  });

  it('classifies a missing Supabase client for every operation', async () => {
    const repository = createSimulationStorageRepository(null);
    await expect(repository.load('project-1')).resolves.toMatchObject({ ok: false, error: { code: 'storage_unavailable' } });
    await expect(repository.save('project-1', 0, state())).resolves.toMatchObject({ ok: false, error: { code: 'storage_unavailable' } });
    await expect(repository.clear('project-1', 0)).resolves.toMatchObject({ ok: false, error: { code: 'storage_unavailable' } });
  });
});
