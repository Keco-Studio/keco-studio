import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import {
  RLS_DB_TESTS_ENABLED,
  buildProjectFixture,
  teardownProjectFixture,
  type ProjectFixture,
  type RlsUser,
} from './helpers/rlsTestClient';

const describeDb = RLS_DB_TESTS_ENABLED ? describe : describe.skip;

describeDb('document collaboration durability RLS (live database)', () => {
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

  async function seedDocument(fixture = fx): Promise<string> {
    const { data, error } = await fixture.svc
      .from('documents')
      .insert({
        project_id: fixture.projectId,
        name: `collab-${fixture.suffix}-${randomUUID().slice(0, 8)}`,
        content: '# Initial',
        created_by: fixture.owner.id,
      })
      .select('id')
      .single();
    if (error || !data) throw new Error(`seedDocument failed: ${error?.message}`);
    return data.id as string;
  }

  async function initialize(actor: RlsUser, documentId: string, state = 'AQID') {
    return actor.client.rpc('initialize_document_collab_state', {
      p_document_id: documentId,
      p_expected_epoch: 0,
      p_yjs_state: state,
      p_markdown: '# Initial',
    });
  }

  it('allows project members to read state and the durable update tail', async () => {
    const documentId = await seedDocument();
    expect((await initialize(fx.owner, documentId)).error).toBeNull();
    const updateId = randomUUID();
    expect(
      (
        await fx.editor.client.from('document_yjs_updates').insert({
          id: updateId,
          document_id: documentId,
          epoch: 0,
          update_data: 'BAUG',
          created_by: fx.editor.id,
        })
      ).error
    ).toBeNull();

    for (const actor of [fx.owner, fx.admin, fx.editor, fx.viewer]) {
      const { data: head, error: headError } = await actor.client
        .from('documents')
        .select('id, yjs_state, collab_epoch, collab_revision')
        .eq('id', documentId)
        .single();
      expect(headError).toBeNull();
      expect(head?.yjs_state).toBe('AQID');

      const { data: tail, error: tailError } = await actor.client
        .from('document_yjs_updates')
        .select('id')
        .eq('document_id', documentId);
      expect(tailError).toBeNull();
      expect(tail?.map((row) => row.id)).toContain(updateId);
    }
  });

  it('allows only owner/admin/editor to initialize and append current-epoch updates', async () => {
    for (const actor of [fx.owner, fx.admin, fx.editor]) {
      const documentId = await seedDocument();
      expect((await initialize(actor, documentId)).error).toBeNull();
      const id = randomUUID();
      expect(
        (
          await actor.client.from('document_yjs_updates').insert({
            id,
            document_id: documentId,
            epoch: 0,
            update_data: 'AQI=',
            created_by: actor.id,
          })
        ).error
      ).toBeNull();
      expect(
        (
          await actor.client.from('document_yjs_updates').insert({
            id,
            document_id: documentId,
            epoch: 0,
            update_data: 'AQI=',
            created_by: actor.id,
          })
        ).error
      ).not.toBeNull();
    }

    const viewerDocumentId = await seedDocument();
    expect((await initialize(fx.viewer, viewerDocumentId)).error).not.toBeNull();
    expect(
      (
        await fx.viewer.client.from('document_yjs_updates').insert({
          id: randomUUID(),
          document_id: viewerDocumentId,
          epoch: 0,
          update_data: 'AQI=',
          created_by: fx.viewer.id,
        })
      ).error
    ).not.toBeNull();
  });

  it('rejects stale epochs and direct body updates but permits metadata updates', async () => {
    const documentId = await seedDocument();
    expect((await initialize(fx.editor, documentId)).error).toBeNull();

    const { error: staleError } = await fx.editor.client
      .from('document_yjs_updates')
      .insert({
        id: randomUUID(),
        document_id: documentId,
        epoch: 1,
        update_data: 'AQI=',
        created_by: fx.editor.id,
      });
    expect(staleError).not.toBeNull();

    const { error: bodyError } = await fx.editor.client
      .from('documents')
      .update({ content: '# Bypass', yjs_state: 'bad' })
      .eq('id', documentId);
    expect(bodyError).not.toBeNull();

    const { error: nameError } = await fx.editor.client
      .from('documents')
      .update({ name: `renamed-${fx.suffix}` })
      .eq('id', documentId);
    expect(nameError).toBeNull();
  });

  it('compacts with CAS and deletes only included update ids', async () => {
    const documentId = await seedDocument();
    const { data: initialized, error: initError } = await initialize(fx.owner, documentId);
    expect(initError).toBeNull();
    const revision = Number((initialized as Array<{ collab_revision: number }>)[0]?.collab_revision);
    const includedId = randomUUID();
    const remainingId = randomUUID();
    const rows = [includedId, remainingId].map((id) => ({
      id,
      document_id: documentId,
      epoch: 0,
      update_data: 'AQI=',
      created_by: fx.owner.id,
    }));
    expect((await fx.owner.client.from('document_yjs_updates').insert(rows)).error).toBeNull();

    const { error: compactError } = await fx.owner.client.rpc('compact_document_collab_state', {
      p_document_id: documentId,
      p_expected_epoch: 0,
      p_expected_revision: revision,
      p_included_update_ids: [includedId],
      p_yjs_state: 'BwgJ',
      p_markdown: '# Compacted',
    });
    expect(compactError).toBeNull();

    const { data: tail } = await fx.svc
      .from('document_yjs_updates')
      .select('id')
      .eq('document_id', documentId);
    expect(tail?.map((row) => row.id)).toEqual([remainingId]);

    const { error: staleRevisionError } = await fx.owner.client.rpc(
      'compact_document_collab_state',
      {
        p_document_id: documentId,
        p_expected_epoch: 0,
        p_expected_revision: revision,
        p_included_update_ids: [remainingId],
        p_yjs_state: 'CgsM',
        p_markdown: '# Stale',
      }
    );
    expect(staleRevisionError).not.toBeNull();
  });

  it('hides another project state and tail from every unrelated role', async () => {
    const documentId = await seedDocument();
    expect((await initialize(fx.owner, documentId)).error).toBeNull();

    for (const actor of [other.owner, other.admin, other.editor, other.viewer]) {
      const { data: heads, error: headError } = await actor.client
        .from('documents')
        .select('id')
        .eq('id', documentId);
      expect(headError).toBeNull();
      expect(heads).toHaveLength(0);

      const { data: tail, error: tailError } = await actor.client
        .from('document_yjs_updates')
        .select('id')
        .eq('document_id', documentId);
      expect(tailError).toBeNull();
      expect(tail).toHaveLength(0);
    }
  });
});
