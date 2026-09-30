import { randomUUID } from 'node:crypto';
import {
  RLS_DB_TESTS_ENABLED, buildProjectFixture, teardownProjectFixture,
  type ProjectFixture,
} from './helpers/rlsTestClient';

const describeDb = RLS_DB_TESTS_ENABLED ? describe : describe.skip;

describeDb('agent Studio copies (live database)', () => {
  let fx: ProjectFixture;

  beforeAll(async () => { fx = await buildProjectFixture(); }, 120_000);
  afterAll(async () => { if (fx) await teardownProjectFixture(fx); }, 60_000);

  it('atomically copies library content, replays a key, and rejects stale source state', async () => {
    const folder = await fx.owner.client.from('folders').insert({
      project_id: fx.projectId, name: `copy-source-${fx.suffix}`,
    }).select('id').single();
    expect(folder.error).toBeNull();
    const source = await fx.owner.client.from('libraries').insert({
      project_id: fx.projectId, folder_id: folder.data!.id, name: `copy-library-${fx.suffix}`,
    }).select('id').single();
    expect(source.error).toBeNull();
    const field = await fx.owner.client.from('library_field_definitions').insert({
      library_id: source.data!.id, section: '__keco_flat_fields__',
      section_id: `${source.data!.id}:keco-flat-fields`, label: 'Name',
      data_type: 'string', order_index: 0,
    }).select('id').single();
    expect(field.error).toBeNull();
    const asset = await fx.owner.client.from('library_assets').insert({
      library_id: source.data!.id, name: 'Hero', row_index: 0,
    }).select('id').single();
    expect(asset.error).toBeNull();
    const value = await fx.owner.client.from('library_asset_values').insert({
      asset_id: asset.data!.id, field_id: field.data!.id, value_json: 'Hero',
    });
    expect(value.error).toBeNull();

    const preview = await fx.owner.client.rpc('agent_prepare_library_copy', {
      p_project_id: fx.projectId, p_source_id: source.data!.id,
    });
    expect(preview.error).toBeNull();
    const idempotencyKey = randomUUID();
    const args = {
      p_project_id: fx.projectId, p_source_id: source.data!.id,
      p_name: `copy-result-${fx.suffix}`, p_copy_header_only: false,
      p_target_folder_id: folder.data!.id,
      p_expected_fingerprint: preview.data.fingerprint as string,
      p_idempotency_key: idempotencyKey,
    };
    const first = await fx.owner.client.rpc('agent_duplicate_library_if_current', args);
    expect(first.error).toBeNull();
    const replay = await fx.owner.client.rpc('agent_duplicate_library_if_current', args);
    expect(replay.error).toBeNull();
    expect(replay.data).toBe(first.data);
    const copiedAssets = await fx.owner.client.from('library_assets')
      .select('id').eq('library_id', first.data as string);
    expect(copiedAssets.error).toBeNull();
    expect(copiedAssets.data).toHaveLength(1);
    const copiedValues = await fx.owner.client.from('library_asset_values')
      .select('value_json').eq('asset_id', copiedAssets.data![0].id);
    expect(copiedValues.error).toBeNull();
    expect(copiedValues.data).toEqual([{ value_json: 'Hero' }]);

    const changed = await fx.owner.client.from('library_asset_values')
      .update({ value_json: 'Changed' })
      .eq('asset_id', asset.data!.id).eq('field_id', field.data!.id);
    expect(changed.error).toBeNull();
    const stale = await fx.owner.client.rpc('agent_duplicate_library_if_current', {
      ...args, p_name: `copy-stale-${fx.suffix}`, p_idempotency_key: randomUUID(),
    });
    expect(stale.error?.code).toBe('PT409');
  });

  it('copies direct folder contents and gives a second copy a distinct name', async () => {
    const source = await fx.owner.client.from('folders').insert({
      project_id: fx.projectId, name: `copy-folder-${fx.suffix}`,
    }).select('id').single();
    expect(source.error).toBeNull();
    const document = await fx.owner.client.from('documents').insert({
      project_id: fx.projectId, folder_id: source.data!.id,
      name: 'Notes', content: '# Story', created_by: fx.owner.id,
    });
    expect(document.error).toBeNull();
    const preview = await fx.owner.client.rpc('agent_prepare_folder_copy', {
      p_project_id: fx.projectId, p_source_id: source.data!.id,
    });
    expect(preview.error).toBeNull();
    const base = { p_project_id: fx.projectId, p_source_id: source.data!.id,
      p_expected_fingerprint: preview.data.fingerprint as string };
    const first = await fx.owner.client.rpc('agent_duplicate_folder_if_current', {
      ...base, p_idempotency_key: randomUUID(),
    });
    const second = await fx.owner.client.rpc('agent_duplicate_folder_if_current', {
      ...base, p_idempotency_key: randomUUID(),
    });
    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    expect(second.data).not.toBe(first.data);
    const copied = await fx.owner.client.from('documents')
      .select('name,content').eq('folder_id', first.data as string);
    expect(copied.error).toBeNull();
    expect(copied.data).toEqual([{ name: 'Notes', content: '# Story' }]);
    const names = await fx.owner.client.from('folders')
      .select('name').in('id', [first.data, second.data] as string[]);
    expect(names.error).toBeNull();
    expect(names.data?.map((row) => row.name).sort()).toEqual([
      `copy-folder-${fx.suffix} (Copy 2)`, `copy-folder-${fx.suffix} (Copy)`,
    ].sort());
  });
});
