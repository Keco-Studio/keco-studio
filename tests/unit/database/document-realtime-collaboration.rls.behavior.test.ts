import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import {
  RLS_DB_TESTS_ENABLED,
  anonClient,
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

  async function append(
    actor: RlsUser,
    documentId: string,
    epoch: number,
    updates: Array<{ id: string; updateBase64: string }>
  ) {
    return actor.client.rpc('append_document_yjs_updates', {
      p_document_id: documentId,
      p_epoch: epoch,
      p_updates: updates,
    });
  }

  it('allows project members to read state and the durable update tail', async () => {
    const documentId = await seedDocument();
    expect((await initialize(fx.owner, documentId)).error).toBeNull();
    const updateId = randomUUID();
    expect(
      (await append(fx.editor, documentId, 0, [{ id: updateId, updateBase64: 'BAUG' }]))
        .error
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

  it('denies anonymous durable update reads', async () => {
    const documentId = await seedDocument();
    expect((await initialize(fx.owner, documentId)).error).toBeNull();
    const { data, error } = await anonClient()
      .from('document_yjs_updates')
      .select('id')
      .eq('document_id', documentId);

    expect(data ?? []).toEqual([]);
    if (error) expect(error.code).toBe('42501');
  });

  it('rejects non-canonical and oversized update and snapshot payloads', async () => {
    const documentId = await seedDocument();
    const oversizedUpdate = Buffer.alloc(262145).toString('base64');
    const nonCanonical = await append(fx.owner, documentId, 0, [
      { id: randomUUID(), updateBase64: 'AQID\n' },
    ]);
    const oversized = await append(fx.owner, documentId, 0, [
      { id: randomUUID(), updateBase64: oversizedUpdate },
    ]);
    const oversizedSnapshot = await initialize(
      fx.owner,
      documentId,
      Buffer.alloc(8388609).toString('base64')
    );
    const oversizedMarkdown = await fx.owner.client.rpc(
      'initialize_document_collab_state',
      {
        p_document_id: documentId,
        p_expected_epoch: 0,
        p_yjs_state: 'AQID',
        p_markdown: 'x'.repeat(2097153),
      }
    );

    expect(nonCanonical.error?.code).toBe('22023');
    expect(oversized.error?.code).toBe('22023');
    expect(oversizedSnapshot.error?.code).toBe('22023');
    expect(oversizedMarkdown.error?.code).toBe('22023');
  });

  it('allows metadata-only document creation but blocks raw state and tail bypasses', async () => {
    const allowed = await fx.editor.client
      .from('documents')
      .insert({
        project_id: fx.projectId,
        folder_id: null,
        name: `guarded-create-${fx.suffix}`,
        content: '# Created',
        created_by: fx.editor.id,
      })
      .select('id, yjs_state, collab_epoch, collab_revision')
      .single();
    expect(allowed.error).toBeNull();
    expect(allowed.data).toMatchObject({
      yjs_state: null,
      collab_epoch: 0,
      collab_revision: 0,
    });

    const rawState = await fx.editor.client.from('documents').insert({
      project_id: fx.projectId,
      name: `raw-state-${fx.suffix}`,
      content: '# Bypass',
      created_by: fx.editor.id,
      yjs_state: 'AQID',
      collab_epoch: 9,
      collab_revision: 9,
    });
    const oversizedDocument = await fx.editor.client.from('documents').insert({
      project_id: fx.projectId,
      name: `oversized-${fx.suffix}`,
      content: 'x'.repeat(2097153),
      created_by: fx.editor.id,
    });
    const rawTail = await fx.editor.client.from('document_yjs_updates').insert({
      id: randomUUID(),
      document_id: allowed.data!.id,
      epoch: 0,
      update_data: Buffer.alloc(262145).toString('base64'),
      created_by: fx.editor.id,
    });

    expect(rawState.error?.code).toBe('42501');
    expect(oversizedDocument.error?.code).toBe('23514');
    expect(rawTail.error?.code).toBe('42501');
  });

  it('rejects invalid compaction snapshots and Markdown before mutation', async () => {
    const documentId = await seedDocument();
    const initialized = await initialize(fx.owner, documentId);
    expect(initialized.error).toBeNull();
    const revision = Number(
      (initialized.data as Array<{ collab_revision: number }>)[0]?.collab_revision
    );

    const invalidSnapshot = await fx.owner.client.rpc(
      'compact_document_collab_state',
      {
        p_document_id: documentId,
        p_expected_epoch: 0,
        p_expected_revision: revision,
        p_included_update_ids: [],
        p_yjs_state: 'AQID\n',
        p_markdown: '# Invalid',
      }
    );
    const invalidMarkdown = await fx.owner.client.rpc(
      'compact_document_collab_state',
      {
        p_document_id: documentId,
        p_expected_epoch: 0,
        p_expected_revision: revision,
        p_included_update_ids: [],
        p_yjs_state: 'AQID',
        p_markdown: 'x'.repeat(2097153),
      }
    );

    expect(invalidSnapshot.error?.code).toBe('22023');
    expect(invalidMarkdown.error?.code).toBe('22023');
    const stored = await fx.svc
      .from('documents')
      .select('content, collab_revision')
      .eq('id', documentId)
      .single();
    expect(stored.data).toMatchObject({
      content: '# Initial',
      collab_revision: revision,
    });
  });

  it('allows only owner/admin/editor to initialize and append current-epoch updates', async () => {
    for (const actor of [fx.owner, fx.admin, fx.editor]) {
      const documentId = await seedDocument();
      expect((await initialize(actor, documentId)).error).toBeNull();
      const id = randomUUID();
      const update = { id, updateBase64: 'AQI=' };
      expect((await append(actor, documentId, 0, [update])).error).toBeNull();
      expect((await append(actor, documentId, 0, [update])).error).toBeNull();
      const { data: stored } = await fx.svc
        .from('document_yjs_updates')
        .select('created_by')
        .eq('id', id);
      expect(stored).toEqual([{ created_by: actor.id }]);
    }

    const viewerDocumentId = await seedDocument();
    expect((await initialize(fx.viewer, viewerDocumentId)).error).not.toBeNull();
    expect(
      (
        await append(fx.viewer, viewerDocumentId, 0, [
          { id: randomUUID(), updateBase64: 'AQI=' },
        ])
      ).error
    ).not.toBeNull();
  });

  it('rejects stale epochs and direct body updates but permits metadata updates', async () => {
    const documentId = await seedDocument();
    expect((await initialize(fx.editor, documentId)).error).toBeNull();

    const { error: staleError } = await append(fx.editor, documentId, 1, [
      { id: randomUUID(), updateBase64: 'AQI=' },
    ]);
    expect(staleError?.code).toBe('PT409');

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
    const updates = [includedId, remainingId].map((id) => ({
      id,
      updateBase64: 'AQI=',
    }));
    expect((await append(fx.owner, documentId, 0, updates)).error).toBeNull();

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
