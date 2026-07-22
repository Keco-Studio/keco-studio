import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  RLS_DB_TESTS_ENABLED,
  buildProjectFixture,
  createConfirmedOutsider,
  teardownProjectFixture,
  type ProjectFixture,
  type RlsUser,
} from './helpers/rlsTestClient';

const describeDb = RLS_DB_TESTS_ENABLED ? describe : describe.skip;
const freshState = { version: 1, activeSessionId: null, sessions: [] };

type RpcRow = { status: string; revision: number | null };

function save(
  client: SupabaseClient,
  projectId: string,
  revision: number,
  state: Record<string, unknown> = freshState
) {
  return client.rpc('save_simulation_state', {
    p_project_id: projectId,
    p_expected_revision: revision,
    p_state_version: 1,
    p_state: state,
  });
}

function reset(client: SupabaseClient, projectId: string, revision: number) {
  return client.rpc('reset_simulation_state', {
    p_project_id: projectId,
    p_expected_revision: revision,
  });
}

describeDb('simulation states RLS and atomic RPCs (live database)', () => {
  let fx: ProjectFixture;
  let pending: RlsUser;

  beforeAll(async () => {
    fx = await buildProjectFixture();
    pending = await createConfirmedOutsider(fx, 'pending-simulation');
    const { error } = await fx.svc.from('project_collaborators').insert({
      user_id: pending.id,
      project_id: fx.projectId,
      role: 'viewer',
      invited_by: fx.owner.id,
      invited_at: new Date().toISOString(),
      accepted_at: null,
    });
    if (error) throw new Error(`create pending collaborator failed: ${error.message}`);
  }, 120_000);

  afterEach(async () => {
    if (fx) {
      await fx.svc.from('simulation_states').delete().eq('project_id', fx.projectId);
    }
  });

  afterAll(async () => {
    if (fx) await teardownProjectFixture(fx);
  }, 60_000);

  it('lets owners and accepted collaborators of every role save and read only their own row', async () => {
    const actors = [fx.owner, fx.admin, fx.editor, fx.viewer];

    for (const actor of actors) {
      const created = await save(actor.client, fx.projectId, 0);
      expect(created.error).toBeNull();
      expect(created.data).toEqual([{ status: 'saved', revision: 1 }]);

      const { data, error } = await actor.client
        .from('simulation_states')
        .select('user_id, project_id, state_version, state, revision')
        .eq('project_id', fx.projectId);
      expect(error).toBeNull();
      expect(data).toEqual([
        {
          user_id: actor.id,
          project_id: fx.projectId,
          state_version: 1,
          state: freshState,
          revision: 1,
        },
      ]);
    }

    const { count, error } = await fx.svc
      .from('simulation_states')
      .select('*', { count: 'exact', head: true })
      .eq('project_id', fx.projectId);
    expect(error).toBeNull();
    expect(count).toBe(actors.length);
  });

  it('hides a same-project member row from every other member', async () => {
    expect((await save(fx.owner.client, fx.projectId, 0)).error).toBeNull();

    for (const actor of [fx.admin, fx.editor, fx.viewer]) {
      const { data, error } = await actor.client
        .from('simulation_states')
        .select('user_id')
        .eq('user_id', fx.owner.id)
        .eq('project_id', fx.projectId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    }
  });

  it('denies outsiders and pending collaborators both reads and mutation RPCs', async () => {
    const blocked = [fx.outsider, pending];
    const { error: seedError } = await fx.svc.from('simulation_states').insert(
      blocked.map((actor) => ({
        user_id: actor.id,
        project_id: fx.projectId,
        state_version: 1,
        state: freshState,
        revision: 1,
      }))
    );
    expect(seedError).toBeNull();

    for (const actor of blocked) {
      const read = await actor.client
        .from('simulation_states')
        .select('revision')
        .eq('project_id', fx.projectId);
      expect(read.error).toBeNull();
      expect(read.data).toEqual([]);

      const write = await save(actor.client, fx.projectId, 1);
      expect(write.error?.code).toBe('42501');
      const remove = await reset(actor.client, fx.projectId, 1);
      expect(remove.error?.code).toBe('42501');
    }
  });

  it('rejects direct authenticated inserts', async () => {
    const { error } = await fx.owner.client.from('simulation_states').insert({
      user_id: fx.owner.id,
      project_id: fx.projectId,
      state_version: 1,
      state: freshState,
      revision: 1,
    });

    expect(error).not.toBeNull();
  });

  it('allows exactly one concurrent save at the same revision', async () => {
    expect((await save(fx.owner.client, fx.projectId, 0)).data).toEqual([
      { status: 'saved', revision: 1 },
    ]);

    const contenders = [
      { ...freshState, activeSessionId: 'first' },
      { ...freshState, activeSessionId: 'second' },
    ];
    const results = await Promise.all(
      contenders.map((state) => save(fx.owner.client, fx.projectId, 1, state))
    );

    expect(results.map((result) => result.error)).toEqual([null, null]);
    const rows = results.flatMap((result) => (result.data ?? []) as RpcRow[]);
    expect(rows.filter((row) => row.status === 'saved')).toEqual([
      { status: 'saved', revision: 2 },
    ]);
    expect(rows.filter((row) => row.status === 'conflict')).toEqual([
      { status: 'conflict', revision: null },
    ]);

    const { data, error } = await fx.svc
      .from('simulation_states')
      .select('state, revision')
      .eq('user_id', fx.owner.id)
      .eq('project_id', fx.projectId)
      .single();
    expect(error).toBeNull();
    expect(data?.revision).toBe(2);
    expect(contenders).toContainEqual(data?.state);
  });

  it('keeps newer state on a stale reset and deletes it at the current revision', async () => {
    expect((await save(fx.owner.client, fx.projectId, 0)).data).toEqual([
      { status: 'saved', revision: 1 },
    ]);
    expect((await save(fx.owner.client, fx.projectId, 1)).data).toEqual([
      { status: 'saved', revision: 2 },
    ]);

    const stale = await reset(fx.owner.client, fx.projectId, 1);
    expect(stale.error).toBeNull();
    expect(stale.data).toEqual([{ status: 'conflict', revision: null }]);
    expect(
      (
        await fx.svc
          .from('simulation_states')
          .select('revision')
          .eq('user_id', fx.owner.id)
          .eq('project_id', fx.projectId)
          .single()
      ).data?.revision
    ).toBe(2);

    const current = await reset(fx.owner.client, fx.projectId, 2);
    expect(current.error).toBeNull();
    expect(current.data).toEqual([{ status: 'reset', revision: null }]);
    const absent = await reset(fx.owner.client, fx.projectId, 0);
    expect(absent.error).toBeNull();
    expect(absent.data).toEqual([{ status: 'reset', revision: null }]);
  });

  it('cascades state rows when either the auth user or project is deleted', async () => {
    const deletedUser = await createConfirmedOutsider(fx, 'simulation-user-cascade');
    const { error: userSeedError } = await fx.svc.from('simulation_states').insert({
      user_id: deletedUser.id,
      project_id: fx.projectId,
      state_version: 1,
      state: freshState,
      revision: 1,
    });
    expect(userSeedError).toBeNull();
    expect((await fx.svc.auth.admin.deleteUser(deletedUser.id)).error).toBeNull();
    const userRows = await fx.svc
      .from('simulation_states')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', deletedUser.id);
    expect(userRows.error).toBeNull();
    expect(userRows.count).toBe(0);

    const { data: project, error: projectError } = await fx.svc
      .from('projects')
      .insert({
        owner_id: fx.owner.id,
        name: `simulation-cascade-${fx.suffix}`,
        description: 'simulation cascade fixture',
      })
      .select('id')
      .single();
    expect(projectError).toBeNull();
    const projectId = project!.id as string;
    const { error: projectSeedError } = await fx.svc.from('simulation_states').insert({
      user_id: fx.owner.id,
      project_id: projectId,
      state_version: 1,
      state: freshState,
      revision: 1,
    });
    expect(projectSeedError).toBeNull();
    expect((await fx.svc.from('projects').delete().eq('id', projectId)).error).toBeNull();
    const projectRows = await fx.svc
      .from('simulation_states')
      .select('*', { count: 'exact', head: true })
      .eq('project_id', projectId);
    expect(projectRows.error).toBeNull();
    expect(projectRows.count).toBe(0);
  });
});
