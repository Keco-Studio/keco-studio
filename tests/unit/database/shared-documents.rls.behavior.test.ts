/**
 * Real-Postgres RLS behavior test for issue #152: shared_documents access must
 * be scoped by project membership instead of blanket authenticated access.
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

describeDb('shared_documents project membership RLS (issue #152, live RLS)', () => {
  let fx: ProjectFixture;

  beforeAll(async () => {
    fx = await buildProjectFixture();
  }, 60_000);

  afterAll(async () => {
    if (fx) await teardownProjectFixture(fx);
  }, 30_000);

  async function seedDocument(label: string): Promise<string> {
    const { data, error } = await fx.svc
      .from('shared_documents')
      .insert({
        doc_id: `rls-doc-${label}-${fx.suffix}`,
        owner_id: fx.owner.id,
        project_id: fx.projectId,
        content: { type: 'doc', content: [] },
      })
      .select('id')
      .single();
    if (error || !data) throw new Error(`seedDocument failed: ${error?.message}`);
    return data.id as string;
  }

  it('lets owner and accepted collaborators read project documents', async () => {
    const id = await seedDocument('read');

    for (const actor of [fx.owner, fx.admin, fx.editor, fx.viewer]) {
      const { data, error } = await actor.client
        .from('shared_documents')
        .select('id')
        .eq('id', id);
      expect(error).toBeNull();
      expect(data?.length).toBe(1);
    }
  });

  it('blocks a non-member from reading or mutating project documents', async () => {
    const id = await seedDocument('outsider');

    const { data: readData, error: readError } = await fx.outsider.client
      .from('shared_documents')
      .select('id')
      .eq('id', id);
    expect(readError).toBeNull();
    expect(readData?.length ?? 0).toBe(0);

    const { error: insertError } = await fx.outsider.client
      .from('shared_documents')
      .insert({
        doc_id: `rls-doc-outsider-insert-${fx.suffix}`,
        owner_id: fx.outsider.id,
        project_id: fx.projectId,
        content: { type: 'doc', content: [] },
      });
    expect(insertError).not.toBeNull();

    const { error: updateError, count } = await fx.outsider.client
      .from('shared_documents')
      .update({ content: { type: 'doc', content: [{ type: 'text', text: 'bad' }] } }, { count: 'exact' })
      .eq('id', id);
    if (!updateError) expect(count ?? 0).toBe(0);

    const { data: unchanged } = await fx.svc
      .from('shared_documents')
      .select('content')
      .eq('id', id)
      .single();
    expect(unchanged?.content).toEqual({ type: 'doc', content: [] });
  });

  it('denies rows without project_id by default', async () => {
    const { data, error } = await fx.svc
      .from('shared_documents')
      .insert({
        doc_id: `rls-doc-null-project-${fx.suffix}`,
        owner_id: fx.owner.id,
        content: { type: 'doc', content: [] },
      })
      .select('id')
      .single();
    if (error || !data) throw new Error(`seed null-project document failed: ${error?.message}`);

    const { data: ownerRead, error: ownerReadError } = await fx.owner.client
      .from('shared_documents')
      .select('id')
      .eq('id', data.id as string);
    expect(ownerReadError).toBeNull();
    expect(ownerRead?.length ?? 0).toBe(0);
  });
});
