/**
 * Real-Postgres RLS behavior test for issue #143: library_field_definitions
 * write policies. Owners and admin/editor collaborators may INSERT/UPDATE/DELETE
 * field definitions; viewers may read but not write; non-members get nothing.
 * Complements library-field-definitions-rls.test.ts (text assertions).
 *
 * Gated by RLS_DB_TESTS=1 (CI only).
 */

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import {
  RLS_DB_TESTS_ENABLED,
  buildProjectFixture,
  teardownProjectFixture,
  type ProjectFixture,
  type RlsUser,
} from './helpers/rlsTestClient';

const describeDb = RLS_DB_TESTS_ENABLED ? describe : describe.skip;

describeDb('library_field_definitions write RLS (issue #143, live RLS)', () => {
  let fx: ProjectFixture;

  beforeAll(async () => {
    fx = await buildProjectFixture();
  }, 60_000);

  afterAll(async () => {
    if (fx) await teardownProjectFixture(fx);
  }, 30_000);

  // Active unique constraint is (section_id, order_index) — see migration
  // 20260129000000. Hand out a distinct order_index per row within the section.
  let nextOrder = 0;
  function fieldRow(label: string) {
    return {
      library_id: fx.libraryId,
      section: 'main',
      // section_id is a NOT NULL stable id (see 20260128000000), consistent per
      // (library, section).
      section_id: `${fx.libraryId}::main`,
      label,
      data_type: 'string',
      order_index: nextOrder++,
    };
  }

  /** Insert a field def via service_role (bypasses RLS) and return its id. */
  async function seedField(label: string): Promise<string> {
    const { data, error } = await fx.svc
      .from('library_field_definitions')
      .insert(fieldRow(label))
      .select('id')
      .single();
    if (error || !data) throw new Error(`seedField failed: ${error?.message}`);
    return data.id as string;
  }

  it('lets an editor collaborator insert a field definition', async () => {
    const { error } = await fx.editor.client
      .from('library_field_definitions')
      .insert(fieldRow(`editor-insert-${fx.suffix}`));
    expect(error).toBeNull();
  });

  it('lets an admin collaborator update a field definition', async () => {
    const id = await seedField(`admin-update-${fx.suffix}`);
    const { error } = await fx.admin.client
      .from('library_field_definitions')
      .update({ label: `admin-updated-${fx.suffix}` })
      .eq('id', id);
    expect(error).toBeNull();
    const { data } = await fx.svc
      .from('library_field_definitions')
      .select('label')
      .eq('id', id)
      .single();
    expect(data?.label).toBe(`admin-updated-${fx.suffix}`);
  });

  it('lets a viewer read but not write field definitions', async () => {
    const id = await seedField(`viewer-read-${fx.suffix}`);

    const { data: readData } = await fx.viewer.client
      .from('library_field_definitions')
      .select('id')
      .eq('id', id);
    expect(readData?.length).toBe(1);

    const { error: insErr } = await fx.viewer.client
      .from('library_field_definitions')
      .insert(fieldRow(`viewer-insert-${fx.suffix}`));
    expect(insErr).not.toBeNull();

    const { error: delErr, count } = await deleteReturningCount(fx.viewer, id);
    // Either an explicit error, or RLS silently filters the row (0 deleted).
    if (!delErr) expect(count ?? 0).toBe(0);
    const { data: still } = await fx.svc
      .from('library_field_definitions')
      .select('id')
      .eq('id', id);
    expect(still?.length).toBe(1);
  });

  it('blocks a non-member from reading or writing field definitions', async () => {
    const id = await seedField(`outsider-${fx.suffix}`);

    const { data: readData } = await fx.outsider.client
      .from('library_field_definitions')
      .select('id')
      .eq('id', id);
    expect(readData?.length ?? 0).toBe(0);

    const { error: insErr } = await fx.outsider.client
      .from('library_field_definitions')
      .insert(fieldRow(`outsider-insert-${fx.suffix}`));
    expect(insErr).not.toBeNull();
  });
});

async function deleteReturningCount(actor: RlsUser, id: string) {
  const { error, count } = await actor.client
    .from('library_field_definitions')
    .delete({ count: 'exact' })
    .eq('id', id);
  return { error, count };
}
