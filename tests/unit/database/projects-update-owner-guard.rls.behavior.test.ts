/**
 * Real-Postgres RLS behavior test for issue #153: projects_update_policy must
 * let admin/editor collaborators edit project metadata but must NOT let anyone
 * reassign owner_id via UPDATE (enforced by the projects_prevent_owner_reassignment
 * trigger). Complements the text-assertion guard in
 * projects-update-owner-guard-rls.test.ts by exercising the live policy.
 *
 * Gated by RLS_DB_TESTS=1 (CI only). See helpers/rlsTestClient.ts.
 */

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import {
  RLS_DB_TESTS_ENABLED,
  buildProjectFixture,
  teardownProjectFixture,
  type ProjectFixture,
} from './helpers/rlsTestClient';

const describeDb = RLS_DB_TESTS_ENABLED ? describe : describe.skip;

describeDb('projects_update_policy owner guard (issue #153, live RLS)', () => {
  let fx: ProjectFixture;

  beforeAll(async () => {
    fx = await buildProjectFixture();
  }, 60_000);

  afterAll(async () => {
    if (fx) await teardownProjectFixture(fx);
  }, 30_000);

  it('lets an editor collaborator update project metadata', async () => {
    const { error } = await fx.editor.client
      .from('projects')
      .update({ name: `renamed-by-editor-${fx.suffix}` })
      .eq('id', fx.projectId);
    expect(error).toBeNull();

    const { data } = await fx.svc.from('projects').select('name').eq('id', fx.projectId).single();
    expect(data?.name).toBe(`renamed-by-editor-${fx.suffix}`);
  });

  it('blocks an editor from reassigning owner_id', async () => {
    const { error } = await fx.editor.client
      .from('projects')
      .update({ owner_id: fx.editor.id })
      .eq('id', fx.projectId);
    // The trigger raises an exception -> supabase surfaces an error.
    expect(error).not.toBeNull();

    const { data } = await fx.svc
      .from('projects')
      .select('owner_id')
      .eq('id', fx.projectId)
      .single();
    expect(data?.owner_id).toBe(fx.owner.id);
  });

  it('blocks a viewer from updating project metadata', async () => {
    const { error } = await fx.viewer.client
      .from('projects')
      .update({ name: `renamed-by-viewer-${fx.suffix}` })
      .eq('id', fx.projectId);
    // RLS denies the row; no rows updated (may be null error with 0 rows) —
    // assert the value did not change rather than relying on error shape.
    if (!error) {
      const { data } = await fx.svc.from('projects').select('name').eq('id', fx.projectId).single();
      expect(data?.name).not.toBe(`renamed-by-viewer-${fx.suffix}`);
    }
  });

  it('blocks a non-member from updating the project', async () => {
    const { error } = await fx.outsider.client
      .from('projects')
      .update({ name: `renamed-by-outsider-${fx.suffix}` })
      .eq('id', fx.projectId);
    if (!error) {
      const { data } = await fx.svc.from('projects').select('name').eq('id', fx.projectId).single();
      expect(data?.name).not.toBe(`renamed-by-outsider-${fx.suffix}`);
    }
  });
});
