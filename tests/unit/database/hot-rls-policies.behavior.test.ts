import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import {
  RLS_DB_TESTS_ENABLED,
  buildProjectFixture,
  teardownProjectFixture,
  type ProjectFixture,
} from './helpers/rlsTestClient';

const describeDb = RLS_DB_TESTS_ENABLED ? describe : describe.skip;

describeDb('optimized hot RLS policies (issue #210, live DB)', () => {
  let fx: ProjectFixture;
  let assetId: string;
  let fieldId: string;

  beforeAll(async () => {
    fx = await buildProjectFixture();
    const { data: field, error: fieldError } = await fx.svc
      .from('library_field_definitions')
      .insert({
        library_id: fx.libraryId,
        section: 'main',
        section_id: `${fx.libraryId}::main`,
        label: `rls-hot-field-${fx.suffix}`,
        data_type: 'string',
        order_index: 0,
      })
      .select('id')
      .single();
    if (fieldError || !field) throw new Error(`seed field failed: ${fieldError?.message}`);
    fieldId = field.id as string;

    const { data: asset, error: assetError } = await fx.svc
      .from('library_assets')
      .insert({ library_id: fx.libraryId, name: `rls-hot-asset-${fx.suffix}` })
      .select('id')
      .single();
    if (assetError || !asset) throw new Error(`seed asset failed: ${assetError?.message}`);
    assetId = asset.id as string;

    const { error: valueError } = await fx.svc
      .from('library_asset_values')
      .insert({ asset_id: assetId, field_id: fieldId, value_json: 'seed' });
    if (valueError) throw new Error(`seed value failed: ${valueError.message}`);

    const { error: versionError } = await fx.svc.from('library_versions').insert({
      library_id: fx.libraryId,
      version_name: `rls-hot-version-${fx.suffix}`,
      version_type: 'manual',
      snapshot_data: { assets: [] },
    });
    if (versionError) throw new Error(`seed version failed: ${versionError.message}`);
  }, 60_000);

  afterAll(async () => {
    if (fx) await teardownProjectFixture(fx);
  }, 30_000);

  it('preserves viewer read access to values, fields, and versions', async () => {
    const [values, fields, versions] = await Promise.all([
      fx.viewer.client.from('library_asset_values').select('asset_id').eq('asset_id', assetId),
      fx.viewer.client.from('library_field_definitions').select('id').eq('id', fieldId),
      fx.viewer.client.from('library_versions').select('id').eq('library_id', fx.libraryId),
    ]);

    expect(values.error).toBeNull();
    expect(values.data).toHaveLength(1);
    expect(fields.error).toBeNull();
    expect(fields.data).toHaveLength(1);
    expect(versions.error).toBeNull();
    expect(versions.data).toHaveLength(1);
  });

  it('preserves editor writes and blocks viewer and outsider access', async () => {
    const editorVersion = await fx.editor.client.from('library_versions').insert({
      library_id: fx.libraryId,
      version_name: `editor-version-${fx.suffix}`,
      version_type: 'manual',
      snapshot_data: { assets: [] },
    });
    expect(editorVersion.error).toBeNull();

    const viewerWrite = await fx.viewer.client
      .from('library_asset_values')
      .update({ value_json: 'viewer-write' })
      .eq('asset_id', assetId)
      .eq('field_id', fieldId)
      .select('asset_id');
    expect(viewerWrite.error).toBeNull();
    expect(viewerWrite.data).toHaveLength(0);

    const outsiderValues = await fx.outsider.client
      .from('library_asset_values')
      .select('asset_id')
      .eq('asset_id', assetId);
    expect(outsiderValues.error).toBeNull();
    expect(outsiderValues.data).toHaveLength(0);
  });
});
