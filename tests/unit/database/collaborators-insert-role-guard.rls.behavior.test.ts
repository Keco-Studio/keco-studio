/**
 * Real-Postgres RLS behavior test for issue #151: collaborators_insert_policy.
 * Authorization matrix:
 *   - owner / admin -> may grant any role (incl. admin)
 *   - editor        -> may grant only 'editor' or 'viewer'
 *   - viewer        -> may not insert collaborators at all
 * Complements collaborators-insert-role-guard-rls.test.ts (text assertions).
 *
 * Gated by RLS_DB_TESTS=1 (CI only).
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import {
  RLS_DB_TESTS_ENABLED,
  buildProjectFixture,
  createConfirmedOutsider,
  teardownProjectFixture,
  type ProjectFixture,
  type RlsUser,
} from './helpers/rlsTestClient';

const describeDb = RLS_DB_TESTS_ENABLED ? describe : describe.skip;

describeDb('collaborators_insert_policy role guard (issue #151, live RLS)', () => {
  let fx: ProjectFixture;
  const invitees: RlsUser[] = [];

  beforeAll(async () => {
    fx = await buildProjectFixture();
  }, 60_000);

  afterEach(async () => {
    // Clean any rows an allowed insert created, so cases stay independent.
    for (const u of invitees) {
      await fx.svc.from('project_collaborators').delete().eq('user_id', u.id).eq('project_id', fx.projectId);
    }
  });

  afterAll(async () => {
    if (fx) await teardownProjectFixture(fx);
  }, 30_000);

  async function invitee(label: string): Promise<RlsUser> {
    const u = await createConfirmedOutsider(fx, label);
    invitees.push(u);
    return u;
  }

  async function tryInsert(actor: RlsUser, targetUserId: string, role: string) {
    return actor.client.from('project_collaborators').insert({
      user_id: targetUserId,
      project_id: fx.projectId,
      role,
      invited_by: actor.id,
      invited_at: new Date().toISOString(),
      accepted_at: new Date().toISOString(),
    });
  }

  it('lets an admin collaborator grant the admin role', async () => {
    const target = await invitee('admin-grant');
    const { error } = await tryInsert(fx.admin, target.id, 'admin');
    expect(error).toBeNull();
  });

  it('lets an editor collaborator grant editor or viewer', async () => {
    const t1 = await invitee('editor-grants-editor');
    expect((await tryInsert(fx.editor, t1.id, 'editor')).error).toBeNull();
    const t2 = await invitee('editor-grants-viewer');
    expect((await tryInsert(fx.editor, t2.id, 'viewer')).error).toBeNull();
  });

  it('blocks an editor from granting the admin role', async () => {
    const target = await invitee('editor-grants-admin');
    const { error } = await tryInsert(fx.editor, target.id, 'admin');
    expect(error).not.toBeNull();
  });

  it('blocks a viewer from inserting any collaborator', async () => {
    const target = await invitee('viewer-grants');
    const { error } = await tryInsert(fx.viewer, target.id, 'viewer');
    expect(error).not.toBeNull();
  });
});
