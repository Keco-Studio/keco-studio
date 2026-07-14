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

describeDb('document version history RLS and transactions (live database)', () => {
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
        name: `version-${fixture.suffix}-${randomUUID().slice(0, 8)}`,
        content: '# Initial',
        created_by: fixture.owner.id,
      })
      .select('id')
      .single();
    if (error || !data) throw new Error(`seedDocument failed: ${error?.message}`);
    return data.id as string;
  }

  async function initialize(actor: RlsUser, documentId: string) {
    const result = await actor.client.rpc('initialize_document_collab_state', {
      p_document_id: documentId,
      p_expected_epoch: 0,
      p_yjs_state: 'AQID',
      p_markdown: '# Initial',
    });
    if (result.error) throw result.error;
    return (result.data as Array<{
      collab_epoch: number;
      collab_revision: number;
    }>)[0]!;
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

  async function tailIds(documentId: string, epoch: number): Promise<string[]> {
    const { data, error } = await fx.svc
      .from('document_yjs_updates')
      .select('id, created_at')
      .eq('document_id', documentId)
      .eq('epoch', epoch)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true });
    if (error) throw error;
    return (data ?? []).map((row) => row.id as string);
  }

  async function createVersion(
    actor: RlsUser,
    documentId: string,
    input: {
      id?: string;
      epoch?: number;
      revision?: number;
      includedIds?: string[];
      name?: string;
      yjsState?: string;
      markdown?: string;
    } = {}
  ) {
    return actor.client.rpc('create_document_version', {
      p_version_id: input.id ?? randomUUID(),
      p_document_id: documentId,
      p_expected_epoch: input.epoch ?? 0,
      p_expected_revision: input.revision ?? 1,
      p_included_update_ids: input.includedIds ?? [],
      p_name: input.name ?? 'Manual checkpoint',
      p_yjs_state: input.yjsState ?? 'AQID',
      p_markdown: input.markdown ?? '# Initial',
    });
  }

  async function restoreVersion(
    actor: RlsUser,
    documentId: string,
    targetVersionId: string,
    input: {
      backupId?: string;
      auditId?: string;
      epoch?: number;
      revision?: number;
      includedIds?: string[];
      currentYjsState?: string;
      currentMarkdown?: string;
    } = {}
  ) {
    return actor.client.rpc('restore_document_version', {
      p_document_id: documentId,
      p_target_version_id: targetVersionId,
      p_backup_version_id: input.backupId ?? randomUUID(),
      p_audit_version_id: input.auditId ?? randomUUID(),
      p_expected_epoch: input.epoch ?? 0,
      p_expected_revision: input.revision ?? 1,
      p_included_update_ids: input.includedIds ?? [],
      p_current_yjs_state: input.currentYjsState ?? 'AQID',
      p_current_markdown: input.currentMarkdown ?? '# Initial',
    });
  }

  it('allows writers to create versions while viewers only read and preview', async () => {
    for (const actor of [fx.owner, fx.admin, fx.editor]) {
      const documentId = await seedDocument();
      await initialize(actor, documentId);
      expect((await createVersion(actor, documentId)).error).toBeNull();
    }

    const viewerDocumentId = await seedDocument();
    await initialize(fx.owner, viewerDocumentId);
    const created = await createVersion(fx.owner, viewerDocumentId, {
      name: 'Viewer preview',
    });
    expect(created.error).toBeNull();
    expect((await createVersion(fx.viewer, viewerDocumentId)).error).not.toBeNull();

    const { data: viewerRows, error: viewerError } = await fx.viewer.client
      .from('document_versions')
      .select('id, document_id, name, version_type, snapshot_content')
      .eq('document_id', viewerDocumentId);
    expect(viewerError).toBeNull();
    expect(viewerRows).toEqual([
      expect.objectContaining({
        document_id: viewerDocumentId,
        name: 'Viewer preview',
        version_type: 'manual',
        snapshot_content: '# Initial',
      }),
    ]);

    const { error: directInsertError } = await fx.owner.client
      .from('document_versions')
      .insert({
        id: randomUUID(),
        document_id: viewerDocumentId,
        project_id: fx.projectId,
        name: 'Bypass',
        version_type: 'manual',
        snapshot_yjs_state: 'AQID',
        snapshot_content: '# Bypass',
        snapshot_epoch: 0,
        snapshot_revision: 1,
      });
    expect(directInsertError).not.toBeNull();
  });

  it('hides every version from non-members and rejects cross-project restore targets', async () => {
    const documentId = await seedDocument();
    await initialize(fx.owner, documentId);
    expect((await createVersion(fx.owner, documentId)).error).toBeNull();

    for (const actor of [other.owner, other.admin, other.editor, other.viewer]) {
      const { data, error } = await actor.client
        .from('document_versions')
        .select('id')
        .eq('document_id', documentId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    }

    const otherDocumentId = await seedDocument(other);
    await initialize(other.owner, otherDocumentId);
    const otherVersionId = randomUUID();
    expect(
      (
        await createVersion(other.owner, otherDocumentId, {
          id: otherVersionId,
        })
      ).error
    ).toBeNull();

    const { error: crossProjectError } = await restoreVersion(
      fx.editor,
      documentId,
      otherVersionId
    );
    expect(crossProjectError).not.toBeNull();
  });

  it('rejects stale tokens and non-exact tails without inserting a version', async () => {
    const documentId = await seedDocument();
    await initialize(fx.owner, documentId);
    const updateId = randomUUID();
    expect(
      (
        await append(fx.editor, documentId, 0, [
          { id: updateId, updateBase64: 'BAUG' },
        ])
      ).error
    ).toBeNull();

    expect(
      (
        await createVersion(fx.editor, documentId, {
          revision: 0,
          includedIds: [updateId],
        })
      ).error?.code
    ).toBe('PT409');
    expect((await createVersion(fx.editor, documentId)).error?.code).toBe('PT409');

    const exactIds = await tailIds(documentId, 0);
    expect(
      (
        await createVersion(fx.editor, documentId, {
          includedIds: exactIds,
          yjsState: 'BwgJ',
          markdown: '# Current',
        })
      ).error
    ).toBeNull();

    const { count } = await fx.svc
      .from('document_versions')
      .select('id', { count: 'exact', head: true })
      .eq('document_id', documentId);
    expect(count).toBe(1);
  });

  it('creates at most one changed automatic checkpoint in ten minutes', async () => {
    const documentId = await seedDocument();
    const initialized = await initialize(fx.owner, documentId);
    const firstId = randomUUID();
    expect(
      (
        await append(fx.owner, documentId, initialized.collab_epoch, [
          { id: firstId, updateBase64: 'BAUG' },
        ])
      ).error
    ).toBeNull();

    const firstCompact = await fx.owner.client.rpc('compact_document_collab_state', {
      p_document_id: documentId,
      p_expected_epoch: initialized.collab_epoch,
      p_expected_revision: initialized.collab_revision,
      p_included_update_ids: [firstId],
      p_yjs_state: 'BwgJ',
      p_markdown: '# First change',
    });
    expect(firstCompact.error).toBeNull();

    const secondId = randomUUID();
    expect(
      (
        await append(fx.editor, documentId, 0, [
          { id: secondId, updateBase64: 'CgsM' },
        ])
      ).error
    ).toBeNull();
    const secondCompact = await fx.editor.client.rpc('compact_document_collab_state', {
      p_document_id: documentId,
      p_expected_epoch: 0,
      p_expected_revision: 2,
      p_included_update_ids: [secondId],
      p_yjs_state: 'DQ4P',
      p_markdown: '# Second change',
    });
    expect(secondCompact.error).toBeNull();

    const unchangedCompact = await fx.owner.client.rpc(
      'compact_document_collab_state',
      {
        p_document_id: documentId,
        p_expected_epoch: 0,
        p_expected_revision: 3,
        p_included_update_ids: [],
        p_yjs_state: 'DQ4P',
        p_markdown: '# Second change',
      }
    );
    expect(unchangedCompact.error).toBeNull();

    const { data: automatic } = await fx.svc
      .from('document_versions')
      .select('version_type, snapshot_content, snapshot_revision')
      .eq('document_id', documentId)
      .eq('version_type', 'automatic');
    expect(automatic).toEqual([
      {
        version_type: 'automatic',
        snapshot_content: '# First change',
        snapshot_revision: 2,
      },
    ]);
  });

  it('restores atomically, preserves a backup and audit, and rejects the old epoch', async () => {
    const documentId = await seedDocument();
    await initialize(fx.owner, documentId);
    const targetVersionId = randomUUID();
    expect(
      (
        await createVersion(fx.owner, documentId, {
          id: targetVersionId,
          name: 'Before rewrite',
        })
      ).error
    ).toBeNull();

    const updateId = randomUUID();
    expect(
      (
        await append(fx.editor, documentId, 0, [
          { id: updateId, updateBase64: 'BAUG' },
        ])
      ).error
    ).toBeNull();
    const exactIds = await tailIds(documentId, 0);
    const backupId = randomUUID();
    const auditId = randomUUID();
    const restored = await restoreVersion(
      fx.editor,
      documentId,
      targetVersionId,
      {
        backupId,
        auditId,
        includedIds: exactIds,
        currentYjsState: 'BwgJ',
        currentMarkdown: '# Newer draft',
      }
    );
    expect(restored.error).toBeNull();
    expect(restored.data).toEqual([
      expect.objectContaining({
        collab_epoch: 1,
        collab_revision: 2,
        yjs_state: 'AQID',
        content: '# Initial',
        backup_version_id: backupId,
        audit_version_id: auditId,
      }),
    ]);

    const { data: versions } = await fx.svc
      .from('document_versions')
      .select('id, version_type, source_version_id, snapshot_content, snapshot_epoch, snapshot_revision')
      .eq('document_id', documentId)
      .order('created_at', { ascending: true });
    expect(versions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: backupId,
          version_type: 'pre_restore',
          source_version_id: null,
          snapshot_content: '# Newer draft',
          snapshot_epoch: 0,
          snapshot_revision: 1,
        }),
        expect.objectContaining({
          id: auditId,
          version_type: 'restore',
          source_version_id: targetVersionId,
          snapshot_content: '# Initial',
          snapshot_epoch: 1,
          snapshot_revision: 2,
        }),
      ])
    );

    const { data: tail } = await fx.svc
      .from('document_yjs_updates')
      .select('id')
      .eq('document_id', documentId);
    expect(tail).toEqual([]);
    expect(
      (
        await append(fx.editor, documentId, 0, [
          { id: randomUUID(), updateBase64: 'CgsM' },
        ])
      ).error?.code
    ).toBe('PT409');
    expect(
      (
        await restoreVersion(fx.viewer, documentId, targetVersionId, {
          epoch: 1,
          revision: 2,
        })
      ).error
    ).not.toBeNull();

    const beforeFailure = await fx.svc
      .from('documents')
      .select('content, yjs_state, collab_epoch, collab_revision')
      .eq('id', documentId)
      .single();
    const countBefore = await fx.svc
      .from('document_versions')
      .select('id', { count: 'exact', head: true })
      .eq('document_id', documentId);
    const rollbackBackupId = randomUUID();
    const failed = await restoreVersion(fx.owner, documentId, targetVersionId, {
      backupId: rollbackBackupId,
      auditId: targetVersionId,
      epoch: 1,
      revision: 2,
    });
    expect(failed.error).not.toBeNull();

    const afterFailure = await fx.svc
      .from('documents')
      .select('content, yjs_state, collab_epoch, collab_revision')
      .eq('id', documentId)
      .single();
    const countAfter = await fx.svc
      .from('document_versions')
      .select('id', { count: 'exact', head: true })
      .eq('document_id', documentId);
    expect(afterFailure.data).toEqual(beforeFailure.data);
    expect(countAfter.count).toBe(countBefore.count);
    expect(
      (
        await fx.svc
          .from('document_versions')
          .select('id')
          .eq('id', rollbackBackupId)
      ).data
    ).toEqual([]);
  });
});
