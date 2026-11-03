import { randomUUID } from 'node:crypto';
import { buildProjectFixture, teardownProjectFixture, RLS_DB_TESTS_ENABLED, enforceRlsDbTestRun, type ProjectFixture } from './helpers/rlsTestClient';
enforceRlsDbTestRun(process.env.REQUIRE_RLS_DB_TESTS === '1', RLS_DB_TESTS_ENABLED);
(RLS_DB_TESTS_ENABLED ? describe : describe.skip)('atomic Script flow writes', () => {
  let fx: ProjectFixture;
  let rowId: string;
  beforeAll(async () => {
    fx = await buildProjectFixture(); rowId = randomUUID();
    const field = await fx.svc.from('library_field_definitions').insert({ library_id: fx.libraryId, section: '__keco_flat_fields__', section_id: `${fx.libraryId}:keco-flat-fields`, label: 'Content', data_type: 'string', order_index: 0 }).select('id').single();
    expect(field.error).toBeNull();
    expect((await fx.svc.from('library_assets').insert({ id: rowId, library_id: fx.libraryId, name: '', row_index: 1 })).error).toBeNull();
    expect((await fx.svc.from('library_asset_values').insert({ asset_id: rowId, field_id: field.data.id, value_json: 'Hello' })).error).toBeNull();
  }, 120000);
  afterAll(async () => { if (fx) await teardownProjectFixture(fx); });
  const read = (actor = fx.owner.id) => fx.svc.rpc('read_script_flow', { p_project_id: fx.projectId, p_library_id: fx.libraryId, p_actor: actor });
  async function save(actor = fx.owner.id, extra = {}) {
    const current = await read();
    return fx.svc.rpc('save_script_flow', { p_project_id: fx.projectId, p_library_id: fx.libraryId, p_actor: actor,
      p_expected: current.data?.fingerprint, p_request_id: randomUUID(), p_hash: 'same',
      p_rows: [{ id: rowId, values: { Content: 'Hello', Commands: 'End' } }], p_state: { version: 1 }, ...extra });
  }
  it('reads only for project members and writes only for accepted writers', async () => {
    expect((await read(fx.outsider.id)).error?.code).toBe('42501');
    expect((await read(fx.viewer.id)).error).toBeNull();
    expect((await save(fx.viewer.id)).error?.code).toBe('42501');
    expect((await save(fx.editor.id)).error).toBeNull();
  });
  it('rejects stale content and never partially writes', async () => {
    expect((await save(fx.owner.id, { p_expected: 'stale' })).error?.code).toBe('PT409');
    const before = await read();
    const bad = await save(fx.owner.id, { p_rows: [{ id: rowId, values: { Content: 'Hello', Commands: 'Jump New', Label: 'New' } }, { id: rowId, values: {} }] });
    expect(bad.error).not.toBeNull();
    expect((await read()).data.fingerprint).toBe(before.data.fingerprint);
  });
  it('replays once and rejects a reused request key with different content', async () => {
    const key = randomUUID();
    const first = await save(fx.owner.id, { p_request_id: key });
    expect(first.error).toBeNull();
    const again = await save(fx.owner.id, { p_request_id: key, p_expected: 'old-version' });
    expect(again.error).toBeNull();
    expect(again.data).toEqual(first.data);
    expect((await save(fx.owner.id, { p_request_id: key, p_hash: 'different' })).error?.code).toBe('PT409');
  });
  it('rejects replacement/deletion of existing rows and changes to ordinary content', async () => {
    expect((await save(fx.owner.id, { p_rows: [{ id: randomUUID(), values: { Commands: 'End' } }] })).error).not.toBeNull();
    expect((await save(fx.owner.id, { p_rows: [{ id: rowId, values: { Content: 'Tampered', Commands: 'End' } }] })).error).not.toBeNull();
  });
  it('denies direct client RPC calls even when an actor ID is forged', async () => {
    const result = await fx.viewer.client.rpc('read_script_flow', { p_project_id: fx.projectId, p_library_id: fx.libraryId, p_actor: fx.owner.id });
    expect(result.error).not.toBeNull();
  });
  it('appends a terminal after sparse existing indices without changing execution order', async () => {
    const second = randomUUID(); const terminal = randomUUID();
    expect((await fx.svc.from('library_assets').update({ row_index: 10 }).eq('id', rowId)).error).toBeNull();
    expect((await fx.svc.from('library_assets').insert({ id: second, library_id: fx.libraryId, name: '', row_index: 20 })).error).toBeNull();
    const saved = await save(fx.owner.id, { p_rows: [{ id: rowId, values: { Content: 'Hello', Commands: '' } }, { id: second, values: { Commands: 'End' } }, { id: terminal, values: { Type: '4', Content: '', Label: 'Stop', Commands: 'End' } }] });
    expect(saved.error).toBeNull();
    expect((await read()).data.data.assets.map((r: { id: string }) => r.id)).toEqual([rowId, second, terminal]);
  });
});
