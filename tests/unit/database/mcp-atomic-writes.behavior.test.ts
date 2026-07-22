import { RLS_DB_TESTS_ENABLED, buildProjectFixture, teardownProjectFixture,
  type ProjectFixture } from './helpers/rlsTestClient';

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
    return { tableId, rowId, fields: typeFields, created };
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
    expect(rowValues[setup.fields.link.id]).toEqual(expect.objectContaining({
      assetId: expect.any(String), fieldId: expect.any(String),
    }));

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
      ['Tags', []],
    ];
    for (const [label, value] of invalidValues) {
      const invalid = await fx.editor.client.rpc('mcp_update_table_row', {
        p_project_id: fx.projectId, p_table_id: setup.tableId, p_row_id: setup.rowId,
        p_row_index: null, p_expected_row_id: setup.rowId, p_values: { [label]: value },
      });
      expect(invalid.error?.code).toBe('22023');
    }
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
});
