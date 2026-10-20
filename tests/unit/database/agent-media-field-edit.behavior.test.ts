import { randomUUID } from 'node:crypto';
import { buildProjectFixture, RLS_DB_TESTS_ENABLED, teardownProjectFixture,
  type ProjectFixture } from './helpers/rlsTestClient';

const describeDb = RLS_DB_TESTS_ENABLED ? describe : describe.skip;

describeDb('agent media field edits (live database)', () => {
  let fx: ProjectFixture;

  beforeAll(async () => { fx = await buildProjectFixture(); }, 120_000);
  afterAll(async () => { if (fx) await teardownProjectFixture(fx); }, 60_000);

  it('preserves existing media values on metadata edit and clears only after approved type change', async () => {
    const fieldId = randomUUID();
    const assetId = randomUUID();
    const mediaValue = { fileName: 'example.wav', fileSize: 512, path: 'test/example.wav' };
    const field = await fx.svc.from('library_field_definitions').insert({
      id: fieldId, library_id: fx.libraryId, section: 'main', section_id: 'main',
      label: 'Attachment', data_type: 'file', order_index: 0, required: false,
    });
    expect(field.error).toBeNull();
    const asset = await fx.svc.from('library_assets').insert({
      id: assetId, library_id: fx.libraryId, name: 'Example', row_index: 0,
    });
    expect(asset.error).toBeNull();
    const value = await fx.svc.from('library_asset_values').insert({
      asset_id: assetId, field_id: fieldId, value_json: mediaValue,
    });
    expect(value.error).toBeNull();

    async function approvalSnapshot() {
      const [library, definition, values] = await Promise.all([
        fx.editor.client.from('libraries').select('updated_at').eq('id', fx.libraryId).single(),
        fx.editor.client.from('library_field_definitions')
          .select('id,library_id,label,data_type,description,required,enum_options,reference_libraries,section,section_id,order_index,formula_expression')
          .eq('id', fieldId).single(),
        fx.editor.client.rpc('agent_field_values_snapshot', {
          p_project_id: fx.projectId, p_table_id: fx.libraryId, p_field_id: fieldId,
        }),
      ]);
      expect(library.error).toBeNull();
      expect(definition.error).toBeNull();
      expect(values.error).toBeNull();
      return {
        p_project_id: fx.projectId, p_table_id: fx.libraryId, p_field_id: fieldId,
        p_expected_updated_at: library.data!.updated_at,
        p_expected_field: definition.data,
        p_expected_value_count: values.data.count,
        p_expected_value_fingerprint: values.data.fingerprint,
      };
    }

    const metadataEdit = await fx.editor.client.rpc('agent_edit_table_field_if_current', {
      ...await approvalSnapshot(),
      p_field: { label: 'Attachment', dataType: 'file', description: 'Sound source',
        required: true, section: 'main', sectionId: 'main' },
      p_clear_values_on_type_change: false,
    });
    expect(metadataEdit.error).toBeNull();
    expect(metadataEdit.data).toMatchObject({ data_type: 'file', required: true,
      description: 'Sound source', cleared_value_count: 0 });
    const preserved = await fx.svc.from('library_asset_values').select('value_json')
      .eq('field_id', fieldId).single();
    expect(preserved.data?.value_json).toEqual(mediaValue);

    const nextField = { label: 'Attachment', dataType: 'audio', description: 'Sound source',
      required: false, section: 'main', sectionId: 'main' };
    const snapshot = await approvalSnapshot();
    const denied = await fx.editor.client.rpc('agent_edit_table_field_if_current', {
      ...snapshot, p_field: nextField, p_clear_values_on_type_change: false,
    });
    expect(denied.error?.code).toBe('PT409');
    const changed = await fx.editor.client.rpc('agent_edit_table_field_if_current', {
      ...snapshot, p_field: nextField, p_clear_values_on_type_change: true,
    });
    expect(changed.error).toBeNull();
    expect(changed.data).toMatchObject({ data_type: 'audio', cleared_value_count: 1 });
    const cleared = await fx.svc.from('library_asset_values').select('asset_id').eq('field_id', fieldId);
    expect(cleared.data).toEqual([]);
  });
});
