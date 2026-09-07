import { createHash, randomUUID } from 'node:crypto';
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
const CHUNK_BYTES = 128 * 1024;

type Upload = {
  id: string;
  documentId: string;
  epoch: number;
  bytes: Buffer;
  chunks: Buffer[];
  sha256: string;
};

describeDb('document chunked update upload (live database)', () => {
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
        name: `chunk-upload-${fixture.suffix}-${randomUUID().slice(0, 8)}`,
        content: '# Initial',
        created_by: fixture.owner.id,
      })
      .select('id')
      .single();
    if (error || !data) throw new Error(error?.message ?? 'document seed failed');
    const initialized = await fixture.owner.client.rpc('initialize_document_collab_state', {
      p_document_id: data.id,
      p_expected_epoch: 0,
      p_yjs_state: 'AQID',
      p_markdown: '# Initial',
    });
    if (initialized.error) throw new Error(initialized.error.message);
    return data.id as string;
  }

  function upload(documentId: string, fill = 7, size = 262_145): Upload {
    const bytes = Buffer.alloc(size, fill);
    const chunks: Buffer[] = [];
    for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
      chunks.push(bytes.subarray(offset, offset + CHUNK_BYTES));
    }
    return {
      id: randomUUID(),
      documentId,
      epoch: 0,
      bytes,
      chunks,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  }

  function identity(value: Upload) {
    return {
      p_upload_id: value.id,
      p_document_id: value.documentId,
      p_epoch: value.epoch,
      p_total_bytes: value.bytes.length,
      p_chunk_count: value.chunks.length,
      p_sha256: value.sha256,
    };
  }

  async function prepare(actor: RlsUser, value: Upload) {
    return actor.client.rpc('prepare_document_yjs_update_upload', identity(value));
  }

  async function put(actor: RlsUser, value: Upload, index: number, bytes = value.chunks[index]!) {
    return actor.client.rpc('put_document_yjs_update_chunk', {
      ...identity(value),
      p_chunk_index: index,
      p_chunk_base64: bytes.toString('base64'),
      p_chunk_sha256: createHash('sha256').update(bytes).digest('hex'),
    });
  }

  async function status(actor: RlsUser, value: Upload) {
    return actor.client.rpc('get_document_yjs_update_upload_status', identity(value));
  }

  async function finalize(actor: RlsUser, value: Upload) {
    return actor.client.rpc('finalize_document_yjs_update_upload', identity(value));
  }

  async function uploadAll(actor: RlsUser, value: Upload, order = [2, 0, 1]) {
    expect((await prepare(actor, value)).error).toBeNull();
    for (const index of order) expect((await put(actor, value, index)).error).toBeNull();
  }

  it('allows owner/admin/editor, reordered chunks, atomic commit, and durable idempotency', async () => {
    for (const actor of [fx.owner, fx.admin, fx.editor]) {
      const documentId = await seedDocument();
      const value = upload(documentId);
      expect((await prepare(actor, value)).data).toEqual({
        status: 'uploading', receivedIndexes: [],
      });
      expect((await put(actor, value, 2)).data).toEqual({ receivedCount: 1 });
      expect((await put(actor, value, 0)).data).toEqual({ receivedCount: 2 });
      expect((await put(actor, value, 0)).data).toEqual({ receivedCount: 2 });
      expect((await prepare(actor, value)).data).toEqual({
        status: 'uploading', receivedIndexes: [0, 2],
      });
      expect((await put(actor, value, 1)).data).toEqual({ receivedCount: 3 });
      expect((await status(actor, value)).data).toEqual({ status: 'ready', missingIndexes: [] });
      expect((await finalize(actor, value)).data).toEqual({ status: 'committed' });
      expect((await finalize(actor, value)).data).toEqual({ status: 'committed' });
      expect((await status(actor, value)).data).toEqual({ status: 'committed', missingIndexes: [] });
      expect((await prepare(actor, value)).data).toEqual({ status: 'committed', receivedIndexes: [] });
      const tail = await fx.svc.from('document_yjs_updates').select('id, update_data, created_by').eq('id', value.id);
      expect(tail.data).toEqual([{ id: value.id, update_data: value.bytes.toString('base64'), created_by: actor.id }]);
      expect((await fx.svc.from('document_yjs_update_upload_chunks').select('*').eq('upload_id', value.id)).data).toEqual([]);
    }
  }, 60_000);

  it('denies viewers, outsiders, anonymous callers, and direct authenticated table access', async () => {
    const value = upload(await seedDocument());
    for (const actor of [fx.viewer, fx.outsider, other.owner]) {
      expect((await prepare(actor, value)).error?.code).toBe('42501');
    }
    expect((await anonClient().rpc('prepare_document_yjs_update_upload', identity(value))).error?.code).toBe('42501');
    expect((await fx.editor.client.from('document_yjs_update_uploads').select('*')).error?.code).toBe('42501');
    expect((await fx.editor.client.from('document_yjs_update_upload_chunks').insert({
      upload_id: value.id,
      chunk_index: 0,
      chunk_data: '\\x00',
      byte_count: 1,
      sha256: '0'.repeat(64),
    })).error?.code).toBe('42501');
  });

  it('rejects immutable collisions, conflicting chunks, malformed chunks, and missing/full-hash failures', async () => {
    const value = upload(await seedDocument());
    expect((await prepare(fx.owner, value)).error).toBeNull();
    expect((await prepare(fx.owner, { ...value, sha256: '0'.repeat(64) })).error?.code).toBe('22023');
    expect((await prepare(fx.editor, value)).error?.code).toBe('22023');
    expect((await put(fx.owner, value, 0)).error).toBeNull();
    expect((await put(fx.owner, value, 0, Buffer.alloc(CHUNK_BYTES, 8))).error?.code).toBe('22023');
    expect((await finalize(fx.owner, value)).error?.code).toBe('22023');
    const wrongSize = await fx.owner.client.rpc('put_document_yjs_update_chunk', {
      ...identity(value), p_chunk_index: 1, p_chunk_base64: 'AA==',
      p_chunk_sha256: createHash('sha256').update(Buffer.from([0])).digest('hex'),
    });
    expect(wrongSize.error?.code).toBe('22023');
    const noncanonical = await fx.owner.client.rpc('put_document_yjs_update_chunk', {
      ...identity(value), p_chunk_index: 1, p_chunk_base64: `${value.chunks[1]!.toString('base64')}\n`,
      p_chunk_sha256: createHash('sha256').update(value.chunks[1]!).digest('hex'),
    });
    expect(noncanonical.error?.code).toBe('22023');
    const badHash = await fx.owner.client.rpc('put_document_yjs_update_chunk', {
      ...identity(value), p_chunk_index: 1, p_chunk_base64: value.chunks[1]!.toString('base64'),
      p_chunk_sha256: '0'.repeat(64),
    });
    expect(badHash.error?.code).toBe('22023');

    const fullHashMismatch = { ...upload(await seedDocument(), 3), sha256: 'f'.repeat(64) };
    await uploadAll(fx.owner, fullHashMismatch);
    expect((await finalize(fx.owner, fullHashMismatch)).error?.code).toBe('22023');
    expect((await fx.svc.from('document_yjs_updates').select('id').eq('id', fullHashMismatch.id)).data).toEqual([]);
  }, 60_000);

  it('rejects stale or out-of-range identities without creating an update', async () => {
    const value = upload(await seedDocument());
    expect((await prepare(fx.owner, { ...value, epoch: 1 })).error?.code).toBe('PT409');
    const tooLarge = { ...value, id: randomUUID(), bytes: Buffer.alloc(8 * 1024 * 1024 + 1), chunks: Array(65).fill(Buffer.alloc(CHUNK_BYTES)), sha256: '0'.repeat(64) };
    expect((await prepare(fx.owner, tooLarge)).error?.code).toBe('22023');
    expect((await fx.svc.from('document_yjs_updates').select('id').eq('id', value.id)).data).toEqual([]);
  });

  it('expires only unfinished uploads, retains committed receipts through compaction, and cascades on document delete', async () => {
    const unfinished = upload(await seedDocument());
    expect((await prepare(fx.owner, unfinished)).error).toBeNull();
    expect((await fx.svc.from('document_yjs_update_uploads').update({ expires_at: '2000-01-01T00:00:00Z' }).eq('id', unfinished.id)).error).toBeNull();
    expect((await fx.svc.rpc('cleanup_expired_document_yjs_update_uploads', { p_limit: 10 })).data).toBeGreaterThanOrEqual(1);
    expect((await status(fx.owner, unfinished)).data).toEqual({ status: 'expired', missingIndexes: [0, 1, 2] });

    const documentId = await seedDocument();
    const committed = upload(documentId);
    await uploadAll(fx.owner, committed);
    expect((await finalize(fx.owner, committed)).error).toBeNull();
    const head = await fx.svc.from('documents').select('collab_revision').eq('id', documentId).single();
    expect((await fx.owner.client.rpc('compact_document_collab_state', {
      p_document_id: documentId,
      p_expected_epoch: 0,
      p_expected_revision: head.data!.collab_revision,
      p_included_update_ids: [committed.id],
      p_yjs_state: 'AQID',
      p_markdown: '# Compacted',
    })).error).toBeNull();
    expect((await status(fx.owner, committed)).data).toEqual({ status: 'committed', missingIndexes: [] });
    expect((await fx.svc.from('document_yjs_updates').select('id').eq('id', committed.id)).data).toEqual([]);
    expect((await fx.svc.from('documents').delete().eq('id', documentId)).error).toBeNull();
    expect((await fx.svc.from('document_yjs_update_uploads').select('id').eq('id', committed.id)).data).toEqual([]);
  }, 60_000);

  it('turns an existing matching tail row into a committed receipt during prepare', async () => {
    const documentId = await seedDocument();
    const value = upload(documentId);
    const seeded = await fx.svc.from('document_yjs_updates').insert({
      id: value.id,
      document_id: documentId,
      epoch: value.epoch,
      update_data: value.bytes.toString('base64'),
      created_by: fx.owner.id,
    });
    expect(seeded.error).toBeNull();

    expect((await prepare(fx.owner, value)).data).toEqual({
      status: 'committed',
      receivedIndexes: [],
    });
    expect((await status(fx.owner, value)).data).toEqual({
      status: 'committed',
      missingIndexes: [],
    });
    expect((await fx.svc.from('document_yjs_update_uploads').select('status').eq('id', value.id)).data)
      .toEqual([{ status: 'committed' }]);
  }, 60_000);
});
