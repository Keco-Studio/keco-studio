import { RLS_DB_TESTS_ENABLED, buildProjectFixture, teardownProjectFixture,
  type ProjectFixture } from './helpers/rlsTestClient';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import * as Y from 'yjs';
import { encodeBase64 } from '@/lib/documents/documentCollaborationProtocol';

jest.setTimeout(30_000);

const describeDb = RLS_DB_TESTS_ENABLED ? describe : describe.skip;

type FieldInput = {
  id: string;
  label: string;
  dataType: string;
  section: string;
  required?: boolean;
  enumOptions?: string[];
  referenceTableIds?: string[];
};

type NormalizedDocument = { yjsStateBase64: string; markdown: string };

function codecProbe(input: Record<string, unknown>): Record<string, unknown> {
  const result = spawnSync(process.execPath, [
    '--import', 'tsx', path.join(process.cwd(), 'tests/helpers/documentCodecProbe.ts'),
  ], {
    cwd: process.cwd(), encoding: 'utf8', input: JSON.stringify(input),
    env: { ...process.env, DOCUMENT_CODEC_COMMONJS: '1' },
  });
  expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: '' });
  return JSON.parse(result.stdout) as Record<string, unknown>;
}

function normalizeMarkdown(markdown: string): NormalizedDocument {
  return codecProbe({ mode: 'normalize', markdown }) as NormalizedDocument;
}

describeDb('MCP atomic writes real Postgres behavior', () => {
  let fx: ProjectFixture;
  let externalProjectId: string;
  let externalLibraryId: string;
  let externalFieldId: string;
  let externalAssetId: string;

  beforeAll(async () => {
    fx = await buildProjectFixture();
    const externalProject = await fx.svc.from('projects').insert({
      owner_id: fx.owner.id, name: `external-${fx.suffix}`,
    }).select('id').single();
    if (externalProject.error || !externalProject.data) {
      throw new Error(`create external project failed: ${externalProject.error?.message}`);
    }
    externalProjectId = externalProject.data.id as string;
    const externalLibrary = await fx.svc.from('libraries').insert({
      project_id: externalProjectId, name: `external-table-${fx.suffix}`,
    }).select('id').single();
    if (externalLibrary.error || !externalLibrary.data) {
      throw new Error(`create external library failed: ${externalLibrary.error?.message}`);
    }
    externalLibraryId = externalLibrary.data.id as string;
    externalFieldId = crypto.randomUUID();
    externalAssetId = crypto.randomUUID();
    const externalFields = await fx.svc.from('library_field_definitions').insert({
      id: externalFieldId, library_id: externalLibraryId, section: 'main',
      section_id: 'main', label: 'Name', data_type: 'string', order_index: 0,
    });
    const externalAssets = await fx.svc.from('library_assets').insert({
      id: externalAssetId, library_id: externalLibraryId, name: 'External', row_index: 1,
    });
    if (externalFields.error || externalAssets.error) {
      throw new Error(`create external reference failed: ${
        externalFields.error?.message ?? externalAssets.error?.message}`);
    }
  });

  afterAll(async () => {
    if (externalProjectId) {
      await fx.svc.from('projects').delete().eq('id', externalProjectId);
    }
    await teardownProjectFixture(fx);
  });

  const fields = (): FieldInput[] => [{ id: crypto.randomUUID(), label: 'Name',
    dataType: 'string', section: 'main', required: true }];

  async function createTable(tableId: string, tableFields: FieldInput[], initialRowId: string) {
    return await fx.editor.client.rpc('mcp_create_table', {
      p_project_id: fx.projectId, p_table_id: tableId, p_folder_id: null,
      p_name: `table-${tableId}-${fx.suffix}`, p_description: null,
      p_fields: tableFields, p_initial_row_id: initialRowId,
    });
  }

  async function createAllTypeTable() {
    const targetTableId = crypto.randomUUID();
    const targetRowId = crypto.randomUUID();
    const targetField = fields()[0];
    const targetTable = await createTable(targetTableId, [targetField], targetRowId);
    expect(targetTable.error).toBeNull();
    const targetRow = await fx.editor.client.rpc('mcp_create_table_row', {
      p_project_id: fx.projectId, p_table_id: targetTableId,
      p_requested_row_id: crypto.randomUUID(), p_values: { Name: 'Target' },
      p_reuse_empty: true,
    });
    expect(targetRow.error).toBeNull();

    const tableId = crypto.randomUUID();
    const rowId = crypto.randomUUID();
    const typeFields = {
      name: { id: crypto.randomUUID(), label: 'Name', dataType: 'string',
        section: 'main', required: true },
      tags: { id: crypto.randomUUID(), label: 'Tags', dataType: 'string_array',
        section: 'main', required: true },
      count: { id: crypto.randomUUID(), label: 'Count', dataType: 'int', section: 'main' },
      counts: { id: crypto.randomUUID(), label: 'Counts', dataType: 'int_array', section: 'main' },
      ratio: { id: crypto.randomUUID(), label: 'Ratio', dataType: 'float', section: 'main' },
      ratios: { id: crypto.randomUUID(), label: 'Ratios', dataType: 'float_array', section: 'main' },
      enabled: { id: crypto.randomUUID(), label: 'Enabled', dataType: 'boolean', section: 'main' },
      status: { id: crypto.randomUUID(), label: 'Status', dataType: 'enum', section: 'main',
        enumOptions: ['open', 'done'] },
      due: { id: crypto.randomUUID(), label: 'Due', dataType: 'date', section: 'main' },
      link: { id: crypto.randomUUID(), label: 'Link', dataType: 'reference', section: 'main',
        referenceTableIds: [targetTableId] },
    } satisfies Record<string, FieldInput>;
    const table = await createTable(tableId, Object.values(typeFields), rowId);
    expect(table.error).toBeNull();
    const created = await fx.editor.client.rpc('mcp_create_table_row', {
      p_project_id: fx.projectId, p_table_id: tableId,
      p_requested_row_id: crypto.randomUUID(), p_reuse_empty: true,
      p_values: {
        Name: 'All types', Tags: ['alpha', 'beta'], Count: 7, Counts: [1, 2],
        Ratio: 1.25, Ratios: [1.5, 2], Status: 'open', Due: '2024-02-29',
        Link: { assetId: targetRowId, fieldId: targetField.id },
      },
    });
    expect(created.error).toBeNull();
    return { tableId, rowId, fields: typeFields, created, targetRowId, targetField };
  }

  async function createRealDocument(markdown: string) {
    const documentId = crypto.randomUUID();
    const normalized = normalizeMarkdown(markdown);
    const created = await fx.editor.client.rpc('mcp_create_document', {
      p_project_id: fx.projectId,
      p_document_id: documentId,
      p_folder_id: null,
      p_name: `mcp-document-${documentId}`,
      p_markdown: normalized.markdown,
      p_yjs_state: normalized.yjsStateBase64,
      p_allow_duplicate: false,
    });
    expect(created.error).toBeNull();
    expect(created.data).toEqual([
      expect.objectContaining({
        document_id: documentId,
        project_id: fx.projectId,
        collab_epoch: 0,
        collab_revision: 1,
        collab_epoch_reason: 'initialize',
        update_ids: [],
      }),
    ]);
    return { documentId, normalized };
  }

  it.each(['owner', 'admin', 'editor'] as const)('%s creates a complete table', async role => {
    const tableId = crypto.randomUUID();
    const result = await fx[role].client.rpc('mcp_create_table', {
      p_project_id: fx.projectId, p_table_id: tableId, p_folder_id: null,
      p_name: 'mcp-' + role + '-' + fx.suffix, p_description: null,
      p_fields: fields(), p_initial_row_id: crypto.randomUUID(),
    });
    expect(result.error).toBeNull();
    expect(result.data[0].table_id).toBe(tableId);
  });

  it.each(['viewer', 'outsider'] as const)('rejects %s writes atomically', async role => {
    const tableId = crypto.randomUUID();
    const result = await fx[role].client.rpc('mcp_create_table', {
      p_project_id: fx.projectId, p_table_id: tableId, p_folder_id: null,
      p_name: 'denied-' + role + '-' + fx.suffix, p_description: null,
      p_fields: fields(), p_initial_row_id: crypto.randomUUID(),
    });
    expect(result.error).not.toBeNull();
    const check = await fx.svc.from('libraries').select('id').eq('id', tableId);
    expect(check.data).toEqual([]);
  });

  it('reuses one empty row then updates it by stable id', async () => {
    const tableId = crypto.randomUUID(), rowId = crypto.randomUUID(), field = fields()[0];
    await fx.editor.client.rpc('mcp_create_table', { p_project_id: fx.projectId,
      p_table_id: tableId, p_folder_id: null, p_name: 'rows-' + fx.suffix,
      p_description: null, p_fields: [field], p_initial_row_id: rowId });
    const created = await fx.editor.client.rpc('mcp_create_table_row', {
      p_project_id: fx.projectId, p_table_id: tableId, p_requested_row_id: crypto.randomUUID(),
      p_values: { Name: 'first' }, p_reuse_empty: true });
    expect(created.error).toBeNull();
    expect(created.data[0].row_id).toBe(rowId);
    const updated = await fx.editor.client.rpc('mcp_update_table_row', {
      p_project_id: fx.projectId, p_table_id: tableId, p_row_id: rowId,
      p_row_index: null, p_expected_row_id: rowId, p_values: { Name: 'second' } });
    expect(updated.error).toBeNull();
    expect(updated.data[0].name).toBe('second');
  });

  it('persists every writable type and rejects invalid scalar, array, date, and reference values', async () => {
    const setup = await createAllTypeTable();
    const rowValues = setup.created.data[0].row_values as Record<string, unknown>;
    expect(rowValues).toMatchObject({
      [setup.fields.name.id]: 'All types',
      [setup.fields.tags.id]: ['alpha', 'beta'],
      [setup.fields.count.id]: 7,
      [setup.fields.counts.id]: [1, 2],
      [setup.fields.ratio.id]: 1.25,
      [setup.fields.ratios.id]: [1.5, 2],
      [setup.fields.enabled.id]: false,
      [setup.fields.status.id]: 'open',
      [setup.fields.due.id]: '2024-02-29',
    });
    expect(rowValues[setup.fields.link.id]).toEqual({
      assetId: setup.targetRowId,
      fieldId: setup.targetField.id,
    });

    const booleanUpdate = await fx.editor.client.rpc('mcp_update_table_row', {
      p_project_id: fx.projectId, p_table_id: setup.tableId, p_row_id: setup.rowId,
      p_row_index: null, p_expected_row_id: setup.rowId, p_values: { Enabled: true },
    });
    expect(booleanUpdate.error).toBeNull();
    expect(booleanUpdate.data[0].row_values[setup.fields.enabled.id]).toBe(true);

    const invalidValues: Array<[string, unknown]> = [
      ['Name', 9],
      ['Tags', ['valid', 9]],
      ['Count', 1.5],
      ['Counts', [1, 2.5]],
      ['Ratio', '1.5'],
      ['Ratios', [1, '2']],
      ['Enabled', 'false'],
      ['Status', 'missing-option'],
      ['Due', '2023-02-29'],
      ['Due', '2024-02-29T00:00:00Z'],
      ['Link', { assetId: crypto.randomUUID(), fieldId: crypto.randomUUID() }],
      ['Link', { assetId: externalAssetId, fieldId: externalFieldId }],
      ['Link', { assetId: setup.targetRowId, fieldId: setup.targetField.id,
        displayValue: 'must not persist' }],
      ['Link', [{ assetId: setup.targetRowId, fieldId: setup.targetField.id,
        extra: true }]],
      ['Tags', []],
    ];
    for (const [label, value] of invalidValues) {
      const invalid = await fx.editor.client.rpc('mcp_update_table_row', {
        p_project_id: fx.projectId, p_table_id: setup.tableId, p_row_id: setup.rowId,
        p_row_index: null, p_expected_row_id: setup.rowId, p_values: { [label]: value },
      });
      expect(invalid.error?.code).toBe('22023');
    }

    const canonicalArray = [{
      fieldId: setup.targetField.id,
      assetId: setup.targetRowId,
    }];
    const canonicalUpdate = await fx.editor.client.rpc('mcp_update_table_row', {
      p_project_id: fx.projectId,
      p_table_id: setup.tableId,
      p_row_id: setup.rowId,
      p_row_index: null,
      p_expected_row_id: setup.rowId,
      p_values: { Link: canonicalArray },
    });
    expect(canonicalUpdate.error).toBeNull();
    expect(canonicalUpdate.data[0].row_values[setup.fields.link.id]).toEqual([{
      assetId: setup.targetRowId,
      fieldId: setup.targetField.id,
    }]);
    const persisted = await fx.svc.from('library_asset_values')
      .select('value_json')
      .eq('asset_id', setup.rowId)
      .eq('field_id', setup.fields.link.id)
      .single();
    expect(persisted.error).toBeNull();
    expect(persisted.data?.value_json).toEqual([{
      assetId: setup.targetRowId,
      fieldId: setup.targetField.id,
    }]);
  });

  it('rejects cross-project reference table definitions atomically', async () => {
    const tableId = crypto.randomUUID();
    const result = await createTable(tableId, [{
      id: crypto.randomUUID(), label: 'External', dataType: 'reference', section: 'main',
      referenceTableIds: [externalLibraryId],
    }], crypto.randomUUID());
    expect(result.error?.code).toBe('23503');
    const check = await fx.svc.from('libraries').select('id').eq('id', tableId);
    expect(check.data).toEqual([]);
  });

  it('selects duplicate and null row indexes by row_index nulls last then id', async () => {
    const tableId = crypto.randomUUID();
    const initialRowId = crypto.randomUUID();
    const field = fields()[0];
    const table = await createTable(tableId, [field], initialRowId);
    expect(table.error).toBeNull();
    const movedInitial = await fx.svc.from('library_assets').update({ row_index: 10 })
      .eq('id', initialRowId);
    expect(movedInitial.error).toBeNull();

    const prefix = crypto.randomUUID().slice(0, 8);
    const duplicateLow = `${prefix}-0000-4000-8000-000000000001`;
    const duplicateHigh = `${prefix}-0000-4000-8000-000000000002`;
    const nullLow = `${prefix}-0000-4000-8000-000000000003`;
    const nullHigh = `${prefix}-0000-4000-8000-000000000004`;
    const inserted = await fx.svc.from('library_assets').insert([
      { id: duplicateLow, library_id: tableId, name: 'duplicate-low', row_index: 5,
        created_at: '2030-01-01T00:00:00Z' },
      { id: duplicateHigh, library_id: tableId, name: 'duplicate-high', row_index: 5,
        created_at: '2020-01-01T00:00:00Z' },
      { id: nullLow, library_id: tableId, name: 'null-low', row_index: null,
        created_at: '2030-01-01T00:00:00Z' },
      { id: nullHigh, library_id: tableId, name: 'null-high', row_index: null,
        created_at: '2020-01-01T00:00:00Z' },
    ]);
    expect(inserted.error).toBeNull();

    const staleExpectedId = await fx.editor.client.rpc('mcp_update_table_row', {
      p_project_id: fx.projectId, p_table_id: tableId, p_row_id: null,
      p_row_index: 1, p_expected_row_id: duplicateHigh, p_values: { Name: 'wrong' },
    });
    expect(staleExpectedId.error?.code).toBe('PT409');

    const duplicateUpdate = await fx.editor.client.rpc('mcp_update_table_row', {
      p_project_id: fx.projectId, p_table_id: tableId, p_row_id: null,
      p_row_index: 1, p_expected_row_id: duplicateLow, p_values: { Name: 'first' },
    });
    expect(duplicateUpdate.error).toBeNull();
    expect(duplicateUpdate.data[0].row_id).toBe(duplicateLow);

    const nullUpdate = await fx.editor.client.rpc('mcp_update_table_row', {
      p_project_id: fx.projectId, p_table_id: tableId, p_row_id: null,
      p_row_index: 4, p_expected_row_id: nullLow, p_values: { Name: 'null-first' },
    });
    expect(nullUpdate.error).toBeNull();
    expect(nullUpdate.data[0].row_id).toBe(nullLow);
  });

  it('creates real-codec documents and keeps replacement service-role-only', async () => {
    const created = await createRealDocument('# Service boundary\n\nOriginal body');
    expect(codecProbe({ mode: 'state', snapshot: created.normalized.yjsStateBase64,
      updates: [] })).toEqual({ markdown: created.normalized.markdown });

    const direct = await fx.editor.client.rpc('mcp_replace_document_content', {
      p_project_id: fx.projectId,
      p_document_id: created.documentId,
      p_actor_user_id: fx.editor.id,
      p_backup_version_id: crypto.randomUUID(),
      p_expected_epoch: 0,
      p_expected_revision: 1,
      p_expected_update_ids: [],
      p_current_yjs_state: created.normalized.yjsStateBase64,
      p_current_markdown: created.normalized.markdown,
      p_replacement_yjs_state: created.normalized.yjsStateBase64,
      p_replacement_markdown: created.normalized.markdown,
    });
    expect(direct.error).not.toBeNull();

    const stored = await fx.svc.from('documents')
      .select('content, yjs_state, collab_epoch, collab_revision')
      .eq('id', created.documentId).single();
    expect(stored.error).toBeNull();
    expect(stored.data).toMatchObject({
      content: created.normalized.markdown,
      yjs_state: created.normalized.yjsStateBase64,
      collab_epoch: 0,
      collab_revision: 1,
    });
  });

  it('replaces once with a backup, increments state, deletes only the consumed tail, and leaves conflicts unchanged', async () => {
    const created = await createRealDocument('# Replacement seed\n\nOriginal body');
    const emptyUpdate = encodeBase64(Y.encodeStateAsUpdate(new Y.Doc()));
    const updateIds = [crypto.randomUUID(), crypto.randomUUID()].sort();
    const insertedTail = await fx.svc.from('document_yjs_updates').insert([
      { id: updateIds[0], document_id: created.documentId, epoch: 0,
        update_data: emptyUpdate, created_by: fx.editor.id,
        created_at: '2026-07-22T00:00:00.000Z' },
      { id: updateIds[1], document_id: created.documentId, epoch: 0,
        update_data: emptyUpdate, created_by: fx.editor.id,
        created_at: '2026-07-22T00:00:00.000Z' },
    ]);
    expect(insertedTail.error).toBeNull();

    const currentMarkdown = codecProbe({ mode: 'state',
      snapshot: created.normalized.yjsStateBase64,
      updates: [emptyUpdate, emptyUpdate] }) as { markdown: string };
    const current = { ...created.normalized, markdown: currentMarkdown.markdown };
    const replacement = normalizeMarkdown('# Replacement winner\n\nNew body');
    const backupVersionId = crypto.randomUUID();
    const replaced = await fx.svc.rpc('mcp_replace_document_content', {
      p_project_id: fx.projectId,
      p_document_id: created.documentId,
      p_actor_user_id: fx.editor.id,
      p_backup_version_id: backupVersionId,
      p_expected_epoch: 0,
      p_expected_revision: 1,
      p_expected_update_ids: updateIds,
      p_current_yjs_state: current.yjsStateBase64,
      p_current_markdown: current.markdown,
      p_replacement_yjs_state: replacement.yjsStateBase64,
      p_replacement_markdown: replacement.markdown,
    });
    expect(replaced.error).toBeNull();
    expect(replaced.data).toEqual([
      expect.objectContaining({
        document_id: created.documentId,
        collab_epoch: 1,
        collab_revision: 2,
        collab_epoch_reason: 'agent',
        backup_version_id: backupVersionId,
      }),
    ]);

    const [document, versions, tail] = await Promise.all([
      fx.svc.from('documents')
        .select('content, yjs_state, collab_epoch, collab_revision, collab_epoch_reason')
        .eq('id', created.documentId).single(),
      fx.svc.from('document_versions')
        .select('id, version_type, snapshot_yjs_state, snapshot_content, snapshot_epoch, snapshot_revision')
        .eq('document_id', created.documentId),
      fx.svc.from('document_yjs_updates').select('id, epoch')
        .eq('document_id', created.documentId),
    ]);
    expect(document.data).toMatchObject({
      content: replacement.markdown,
      yjs_state: replacement.yjsStateBase64,
      collab_epoch: 1,
      collab_revision: 2,
      collab_epoch_reason: 'agent',
    });
    expect(versions.data).toEqual([{
      id: backupVersionId,
      version_type: 'pre_agent',
      snapshot_yjs_state: current.yjsStateBase64,
      snapshot_content: current.markdown,
      snapshot_epoch: 0,
      snapshot_revision: 1,
    }]);
    expect(tail.data).toEqual([]);

    const beforeConflict = {
      document: document.data,
      versions: versions.data,
      tail: tail.data,
    };
    const conflict = await fx.svc.rpc('mcp_replace_document_content', {
      p_project_id: fx.projectId,
      p_document_id: created.documentId,
      p_actor_user_id: fx.owner.id,
      p_backup_version_id: crypto.randomUUID(),
      p_expected_epoch: 0,
      p_expected_revision: 1,
      p_expected_update_ids: updateIds,
      p_current_yjs_state: current.yjsStateBase64,
      p_current_markdown: current.markdown,
      p_replacement_yjs_state: created.normalized.yjsStateBase64,
      p_replacement_markdown: created.normalized.markdown,
    });
    expect(conflict.error?.code).toBe('PT409');
    const [afterDocument, afterVersions, afterTail] = await Promise.all([
      fx.svc.from('documents')
        .select('content, yjs_state, collab_epoch, collab_revision, collab_epoch_reason')
        .eq('id', created.documentId).single(),
      fx.svc.from('document_versions')
        .select('id, version_type, snapshot_yjs_state, snapshot_content, snapshot_epoch, snapshot_revision')
        .eq('document_id', created.documentId),
      fx.svc.from('document_yjs_updates').select('id, epoch')
        .eq('document_id', created.documentId),
    ]);
    expect({ document: afterDocument.data, versions: afterVersions.data, tail: afterTail.data })
      .toEqual(beforeConflict);
  });

  it('allows exactly one of two service-role document replacements to win', async () => {
    const created = await createRealDocument('# Concurrent seed');
    const replacements = ['first', 'second'].map(label => normalizeMarkdown(`# ${label} winner`));

    const attempts = await Promise.all(replacements.map((replacement) =>
      fx.svc.rpc('mcp_replace_document_content', {
        p_project_id: fx.projectId,
        p_document_id: created.documentId,
        p_actor_user_id: fx.editor.id,
        p_backup_version_id: crypto.randomUUID(),
        p_expected_epoch: 0,
        p_expected_revision: 1,
        p_expected_update_ids: [],
        p_current_yjs_state: created.normalized.yjsStateBase64,
        p_current_markdown: created.normalized.markdown,
        p_replacement_yjs_state: replacement.yjsStateBase64,
        p_replacement_markdown: replacement.markdown,
      })
    ));
    expect(attempts.filter(result => result.error === null)).toHaveLength(1);
    expect(attempts.filter(result => result.error?.code === 'PT409')).toHaveLength(1);

    const [document, versions] = await Promise.all([
      fx.svc.from('documents').select('content, collab_epoch, collab_revision')
        .eq('id', created.documentId).single(),
      fx.svc.from('document_versions').select('id', { count: 'exact' })
        .eq('document_id', created.documentId),
    ]);
    expect(replacements.map(value => value.markdown)).toContain(document.data?.content);
    expect(document.data).toMatchObject({ collab_epoch: 1, collab_revision: 2 });
    expect(versions.count).toBe(1);
  });
});
