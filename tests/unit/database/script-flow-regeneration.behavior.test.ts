import { randomUUID } from 'node:crypto';
import { buildProjectFixture, teardownProjectFixture, RLS_DB_TESTS_ENABLED, enforceRlsDbTestRun, type ProjectFixture } from './helpers/rlsTestClient';
enforceRlsDbTestRun(process.env.REQUIRE_RLS_DB_TESTS === '1', RLS_DB_TESTS_ENABLED);
(RLS_DB_TESTS_ENABLED ? describe : describe.skip)('flow-preserving generation transaction', () => {
  let fx: ProjectFixture; let systemId: string; let stage: string; let jobId: string; let stageRow: string;
  async function insert(table: string, value: object) {
    const result = await fx.svc.from(table).insert(value).select('*').single();
    if (result.error) throw new Error(`${table}: ${result.error.message}`);
    return result.data;
  }
  beforeAll(async () => {
    fx = await buildProjectFixture();
    systemId = (await insert('game_design_systems', { owner_id: fx.owner.id, title: 'Flow fixture', body: '' })).id;
    const version = await insert('game_design_system_versions', { system_id: systemId, version_number: 1, rules: {}, rendered_markdown: '', content_hash: 'a'.repeat(64) });
    const series = await insert('gdd_resource_series', { project_id: fx.projectId, design_system_id: systemId });
    const doc = await insert('documents', { project_id: fx.projectId, name: 'Flow source', content: 'Hello' });
    const generation = await insert('gdd_generation_jobs', { owner_id: fx.owner.id, project_id: fx.projectId, design_system_id: systemId, version_id: version.id, input: {}, generation_series_id: series.id, generation_revision: 2 });
    jobId = randomUUID();
    await insert('dialogue_generation_jobs', { id: jobId, gdd_generation_job_id: generation.id, project_id: fx.projectId, chapter_key: 'chapter', title: 'chapter', source_content: 'Hello', document_id: doc.id, status: 'running', lease_owner: 'flow-test', lease_expires_at: new Date(Date.now() + 300000).toISOString() });
    expect((await fx.svc.from('libraries').update({ source_document_id: doc.id, document_export_type: 'script' }).eq('id', fx.libraryId)).error).toBeNull();
    await insert('script_flow_states', { library_id: fx.libraryId, state: { version: 1, bindings: [], terminalIds: [] } });
    await insert('gdd_series_resources', { series_id: series.id, project_id: fx.projectId, design_system_id: systemId, resource_kind: 'script_table', logical_key: 'chapter', content_hash: 'b'.repeat(64), library_id: fx.libraryId });
    stage = (await insert('libraries', { project_id: fx.projectId, name: 'Flow staging', source_document_id: doc.id, document_export_type: 'script', dialogue_generation_job_id: jobId, dialogue_generation_ready: false, dialogue_generation_source_epoch: 0, dialogue_generation_source_revision: 0 })).id;
    stageRow = (await insert('library_assets', { library_id: stage, name: '', row_index: 0 })).id;
    let order = 0;
    for (const [label, value] of Object.entries({ Content: 'Hello', Commands: '', Label: 'Start' })) {
      const field = await insert('library_field_definitions', { library_id: stage, section: '__keco_flat_fields__', section_id: `${stage}:keco-flat-fields`, label, data_type: 'string', order_index: order++ });
      await insert('library_asset_values', { asset_id: stageRow, field_id: field.id, value_json: value });
    }
  }, 120000);
  afterAll(async () => {
    if (fx) await teardownProjectFixture(fx);
    if (systemId) { await fx.svc.from('game_design_system_versions').delete().eq('system_id', systemId); await fx.svc.from('game_design_systems').delete().eq('id', systemId); }
  }, 60000);
  const params = () => ({ p_job_id: jobId, p_worker_id: 'flow-test', p_script_library_id: stage, p_source_epoch: 0, p_source_revision: 0, p_source_update_ids: [] });
  it('blocks old workers before overwriting an edited Script', async () => {
    expect((await fx.svc.rpc('finalize_dialogue_script_import', params())).error?.code).toBe('PT409');
  });
  it('rejects stale flow and rolls back staging changes on a failed finalization fence', async () => {
    const ctx = await fx.svc.rpc('script_flow_regeneration_context', { p_job_id: jobId });
    expect(ctx.error).toBeNull();
    const payload = { ...params(), p_expected_flow: ctx.data.fingerprint, p_rows: [{ id: stageRow, values: { Content: 'Hello', Label: 'Start', Commands: 'End' } }], p_state: { version: 1, bindings: [], terminalIds: [] } };
    expect((await fx.svc.rpc('finalize_dialogue_script_import_with_flow', { ...payload, p_expected_flow: 'stale' })).error?.code).toBe('PT409');
    expect((await fx.svc.rpc('finalize_dialogue_script_import_with_flow', { ...payload, p_worker_id: 'expired-worker' })).error?.code).toBe('PT409');
    const before = await fx.svc.rpc('script_flow_data', { p_library_id: stage });
    const commandId = before.data.fields.find((f: { label: string }) => f.label === 'Commands').id;
    expect(before.data.assets[0].propertyValues[commandId]).toBe('');
    const success = await fx.svc.rpc('finalize_dialogue_script_import_with_flow', payload);
    expect(success.error).toBeNull();
    expect(success.data[0].script_library_id).toBe(fx.libraryId);
    const after = await fx.svc.rpc('script_flow_data', { p_library_id: fx.libraryId });
    expect(after.data.assets[0].propertyValues[commandId]).toBe('End');
    expect((await fx.svc.from('libraries').select('id').eq('id', stage)).data).toHaveLength(0);
  });
});
