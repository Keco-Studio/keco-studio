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

  async function replaceWithMarkdown(
    actor: RlsUser,
    documentId: string,
    input: {
      backupId?: string;
      epoch?: number;
      revision?: number;
      includedIds?: string[];
      currentYjsState?: string;
      currentMarkdown?: string;
      replacementYjsState?: string;
      replacementMarkdown?: string;
    } = {}
  ) {
    return fx.svc.rpc('replace_document_with_markdown', {
      p_document_id: documentId,
      p_actor_user_id: actor.id,
      p_backup_version_id: input.backupId ?? randomUUID(),
      p_expected_epoch: input.epoch ?? 0,
      p_expected_revision: input.revision ?? 1,
      p_included_update_ids: input.includedIds ?? [],
      p_current_yjs_state: input.currentYjsState ?? 'AQID',
      p_current_markdown: input.currentMarkdown ?? '# Initial',
      p_replacement_yjs_state: input.replacementYjsState ?? 'BwgJ',
      p_replacement_markdown: input.replacementMarkdown ?? '# Agent edit',
    });
  }

  async function createImportCheckpoint(
    actor: RlsUser,
    documentId: string,
    input: { epoch?: number; revision?: number; name?: string } = {}
  ) {
    return actor.client.rpc('create_document_import_checkpoint', {
      p_version_id: randomUUID(),
      p_document_id: documentId,
      p_expected_epoch: input.epoch ?? 0,
      p_expected_revision: input.revision ?? 1,
      p_name: input.name ?? 'Initial import',
    });
  }

  function importedDocumentArgs(
    documentId: string,
    versionId: string,
    overrides: Partial<{
      actorUserId: string;
      projectId: string;
      folderId: string | null;
      name: string;
      markdown: string;
      yjsState: string;
    }> = {}
  ) {
    return {
      p_document_id: documentId,
      p_version_id: versionId,
      p_actor_user_id: overrides.actorUserId ?? fx.editor.id,
      p_project_id: overrides.projectId ?? fx.projectId,
      p_folder_id: overrides.folderId ?? null,
      p_name: overrides.name ?? 'Imported guide',
      p_markdown: overrides.markdown ?? '# Imported',
      p_yjs_state: overrides.yjsState ?? 'AQID',
    };
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

  it('atomically backs up and replaces state for a confirmed Agent edit', async () => {
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
    let includedIds = await tailIds(documentId, 0);

    expect(
      (
        await replaceWithMarkdown(fx.viewer, documentId, {
          includedIds,
          currentYjsState: 'CgsM',
          currentMarkdown: '# Current',
        })
      ).error
    ).not.toBeNull();

    expect(
      (
        await append(fx.editor, documentId, 0, [
          { id: randomUUID(), updateBase64: 'BwgJ' },
        ])
      ).error
    ).toBeNull();
    expect(
      (
        await replaceWithMarkdown(fx.editor, documentId, {
          includedIds,
          currentYjsState: 'CgsM',
          currentMarkdown: '# Current',
        })
      ).error?.code
    ).toBe('PT409');
    includedIds = await tailIds(documentId, 0);

    const replaced = await replaceWithMarkdown(fx.editor, documentId, {
      includedIds,
      currentYjsState: 'CgsM',
      currentMarkdown: '# Current',
      replacementYjsState: 'DQ4P',
      replacementMarkdown: '# Confirmed Agent edit',
    });
    expect(replaced.error).toBeNull();
    expect(replaced.data).toEqual([
      expect.objectContaining({
        collab_epoch: 1,
        collab_revision: 2,
        yjs_state: 'DQ4P',
        content: '# Confirmed Agent edit',
      }),
    ]);

    const { data: versions, error: versionsError } = await fx.svc
      .from('document_versions')
      .select('version_type, snapshot_content, snapshot_epoch, snapshot_revision')
      .eq('document_id', documentId);
    expect(versionsError).toBeNull();
    expect(versions).toEqual([
      expect.objectContaining({
        version_type: 'pre_agent',
        snapshot_content: '# Current',
        snapshot_epoch: 0,
        snapshot_revision: 1,
      }),
    ]);

    expect(
      (
        await append(fx.editor, documentId, 0, [
          { id: randomUUID(), updateBase64: 'EBES' },
        ])
      ).error?.code
    ).toBe('PT409');
  });

  it('creates an import checkpoint only for a writer in the document project', async () => {
    const documentId = await seedDocument();
    await initialize(fx.owner, documentId);

    expect((await createImportCheckpoint(fx.viewer, documentId)).error).not.toBeNull();
    expect((await createImportCheckpoint(fx.outsider, documentId)).error).not.toBeNull();

    const created = await createImportCheckpoint(fx.editor, documentId);
    expect(created.error).toBeNull();
    expect(created.data).toEqual([
      expect.objectContaining({
        document_id: documentId,
        project_id: fx.projectId,
        name: 'Initial import',
        version_type: 'import',
        snapshot_epoch: 0,
        snapshot_revision: 1,
        created_by: fx.editor.id,
      }),
    ]);

    const { data: versions, error } = await fx.svc
      .from('document_versions')
      .select('version_type, snapshot_content, snapshot_yjs_state')
      .eq('document_id', documentId);
    expect(error).toBeNull();
    expect(versions).toEqual([
      expect.objectContaining({
        version_type: 'import',
        snapshot_content: '# Initial',
        snapshot_yjs_state: 'AQID',
      }),
    ]);
  });

  it('atomically publishes an imported collaborative document and checkpoint', async () => {
    const documentId = randomUUID();
    const versionId = randomUUID();
    const created = await fx.svc.rpc('create_imported_document', {
      p_document_id: documentId,
      p_version_id: versionId,
      p_actor_user_id: fx.editor.id,
      p_project_id: fx.projectId,
      p_folder_id: null,
      p_name: 'Imported guide',
      p_markdown: '# Imported',
      p_yjs_state: 'AQID',
    });

    expect(created.error).toBeNull();
    expect(created.data).toEqual([
      expect.objectContaining({
        id: documentId,
        project_id: fx.projectId,
        name: 'Imported guide',
        content: '# Imported',
      }),
    ]);

    const { data: version, error: versionError } = await fx.svc
      .from('document_versions')
      .select('id, document_id, version_type, snapshot_content, snapshot_revision')
      .eq('id', versionId)
      .single();
    expect(versionError).toBeNull();
    expect(version).toMatchObject({
      document_id: documentId,
      version_type: 'import',
      snapshot_content: '# Imported',
      snapshot_revision: 1,
    });

    for (const actor of [fx.viewer, fx.outsider]) {
      const deniedDocumentId = randomUUID();
      const denied = await fx.svc.rpc('create_imported_document', {
        p_document_id: deniedDocumentId,
        p_version_id: randomUUID(),
        p_actor_user_id: actor.id,
        p_project_id: fx.projectId,
        p_folder_id: null,
        p_name: 'Denied import',
        p_markdown: '# Denied',
        p_yjs_state: 'AQID',
      });
      expect(denied.error).not.toBeNull();
      expect(
        (await fx.svc.from('documents').select('id').eq('id', deniedDocumentId)).data
      ).toEqual([]);
    }
  });

  it('idempotently returns the same import for sequential and concurrent retries', async () => {
    const sequentialDocumentId = randomUUID();
    const sequentialVersionId = randomUUID();
    const first = await fx.svc.rpc(
      'create_imported_document',
      importedDocumentArgs(sequentialDocumentId, sequentialVersionId)
    );
    const retried = await fx.svc.rpc(
      'create_imported_document',
      importedDocumentArgs(sequentialDocumentId, sequentialVersionId, {
        yjsState: 'BwgJ',
      })
    );

    expect(first.error).toBeNull();
    expect(retried.error).toBeNull();
    expect(retried.data).toEqual(first.data);

    const concurrentDocumentId = randomUUID();
    const concurrentVersionId = randomUUID();
    const concurrent = await Promise.all([
      fx.svc.rpc(
        'create_imported_document',
        importedDocumentArgs(concurrentDocumentId, concurrentVersionId)
      ),
      fx.svc.rpc(
        'create_imported_document',
        importedDocumentArgs(concurrentDocumentId, concurrentVersionId, {
          yjsState: 'BwgJ',
        })
      ),
    ]);

    expect(concurrent.map((result) => result.error)).toEqual([null, null]);
    expect(concurrent[1]?.data).toEqual(concurrent[0]?.data);
  });

  it('rejects import ids reused with different semantic input or actor scope', async () => {
    const documentId = randomUUID();
    const versionId = randomUUID();
    expect(
      (await fx.svc.rpc(
        'create_imported_document',
        importedDocumentArgs(documentId, versionId)
      )).error
    ).toBeNull();

    const { data: folder, error: folderError } = await fx.svc
      .from('folders')
      .insert({ project_id: fx.projectId, name: `import-${randomUUID()}` })
      .select('id')
      .single();
    expect(folderError).toBeNull();

    const conflicts = [
      { name: 'Changed name' },
      { markdown: '# Changed' },
      { actorUserId: fx.admin.id },
      { folderId: folder!.id as string },
      { actorUserId: other.editor.id, projectId: other.projectId },
    ];
    for (const overrides of conflicts) {
      const result = await fx.svc.rpc(
        'create_imported_document',
        importedDocumentArgs(documentId, versionId, overrides)
      );
      expect(result.error?.code).toBe('22023');
    }

    const changedVersion = await fx.svc.rpc(
      'create_imported_document',
      importedDocumentArgs(documentId, randomUUID())
    );
    expect(changedVersion.error?.code).toBe('22023');
  });

  it('allows only one document to claim a concurrently reused import version id', async () => {
    const versionId = randomUUID();
    const documentIds = [randomUUID(), randomUUID()];
    const results = await Promise.all(documentIds.map((documentId) =>
      fx.svc.rpc(
        'create_imported_document',
        importedDocumentArgs(documentId, versionId)
      )
    ));

    expect(results.filter((result) => result.error === null)).toHaveLength(1);
    expect(results.filter((result) => result.error?.code === '22023')).toHaveLength(1);
    const { count, error } = await fx.svc
      .from('documents')
      .select('id', { count: 'exact', head: true })
      .in('id', documentIds);
    expect(error).toBeNull();
    expect(count).toBe(1);
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
