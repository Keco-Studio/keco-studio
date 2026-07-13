/**
 * Real-Postgres RLS behavior test for the Phase 1 documents feature.
 *
 * Verifies the project-membership model on public.documents:
 *  - owner + every accepted collaborator (viewers included) can READ,
 *  - only owner/admin/editor can WRITE (viewers are read-only),
 *  - non-members are fully denied, and
 *  - documents are isolated across projects (cross-project read is denied).
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

describeDb('documents project membership RLS (live RLS)', () => {
  let fx: ProjectFixture;
  let other: ProjectFixture;

  beforeAll(async () => {
    fx = await buildProjectFixture();
    other = await buildProjectFixture();
  }, 120_000);

  afterAll(async () => {
    if (fx) await teardownProjectFixture(fx);
    if (other) await teardownProjectFixture(other);
  }, 60_000);

  async function seedDocument(fixture: ProjectFixture, label: string): Promise<string> {
    const { data, error } = await fixture.svc
      .from('documents')
      .insert({
        project_id: fixture.projectId,
        name: `rls-doc-${label}-${fixture.suffix}`,
        content: '# Hello',
        created_by: fixture.owner.id,
      })
      .select('id')
      .single();
    if (error || !data) throw new Error(`seedDocument failed: ${error?.message}`);
    return data.id as string;
  }

  it('lets owner and every accepted collaborator (including viewer) read documents', async () => {
    const id = await seedDocument(fx, 'read');

    for (const actor of [fx.owner, fx.admin, fx.editor, fx.viewer]) {
      const { data, error } = await actor.client
        .from('documents')
        .select('id')
        .eq('id', id);
      expect(error).toBeNull();
      expect(data?.length).toBe(1);
    }
  });

  it('allows owner/admin/editor to write but keeps viewers read-only', async () => {
    const id = await seedDocument(fx, 'write');

    // Editor can update content.
    const { error: editorUpdateError } = await fx.editor.client
      .from('documents')
      .update({ content: '# Edited by editor' })
      .eq('id', id);
    expect(editorUpdateError).toBeNull();

    // Viewer cannot update (RLS denies; row count unaffected).
    const { error: viewerUpdateError, count } = await fx.viewer.client
      .from('documents')
      .update({ content: '# Viewer tried' }, { count: 'exact' })
      .eq('id', id);
    if (!viewerUpdateError) expect(count ?? 0).toBe(0);

    // Viewer cannot insert.
    const { error: viewerInsertError } = await fx.viewer.client
      .from('documents')
      .insert({
        project_id: fx.projectId,
        name: `rls-doc-viewer-insert-${fx.suffix}`,
        content: 'nope',
      });
    expect(viewerInsertError).not.toBeNull();

    const { data: stored } = await fx.svc
      .from('documents')
      .select('content')
      .eq('id', id)
      .single();
    expect(stored?.content).toBe('# Edited by editor');
  });

  it('blocks a non-member from reading or mutating project documents', async () => {
    const id = await seedDocument(fx, 'outsider');

    const { data: readData, error: readError } = await fx.outsider.client
      .from('documents')
      .select('id')
      .eq('id', id);
    expect(readError).toBeNull();
    expect(readData?.length ?? 0).toBe(0);

    const { error: insertError } = await fx.outsider.client
      .from('documents')
      .insert({
        project_id: fx.projectId,
        name: `rls-doc-outsider-insert-${fx.suffix}`,
        content: 'bad',
      });
    expect(insertError).not.toBeNull();

    const { error: deleteError, count } = await fx.outsider.client
      .from('documents')
      .delete({ count: 'exact' })
      .eq('id', id);
    if (!deleteError) expect(count ?? 0).toBe(0);
  });

  it('isolates documents across projects (members of another project cannot read)', async () => {
    const id = await seedDocument(fx, 'cross');

    // Every member of an unrelated project must not see this document.
    for (const actor of [other.owner, other.admin, other.editor, other.viewer]) {
      const { data, error } = await actor.client
        .from('documents')
        .select('id')
        .eq('id', id);
      expect(error).toBeNull();
      expect(data?.length ?? 0).toBe(0);
    }
  });
});
