import { RLS_DB_TESTS_ENABLED, buildProjectFixture, teardownProjectFixture,
  type ProjectFixture } from './helpers/rlsTestClient';

const describeDb = RLS_DB_TESTS_ENABLED ? describe : describe.skip;

describeDb('MCP atomic writes real Postgres behavior', () => {
  let fx: ProjectFixture;
  beforeAll(async () => { fx = await buildProjectFixture(); });
  afterAll(async () => { await teardownProjectFixture(fx); });

  const fields = () => [{ id: crypto.randomUUID(), label: 'Name',
    dataType: 'string', section: 'main', required: true }];

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
    const tableId=crypto.randomUUID(), rowId=crypto.randomUUID(), field=fields()[0];
    await fx.editor.client.rpc('mcp_create_table', { p_project_id:fx.projectId,
      p_table_id:tableId,p_folder_id:null,p_name:'rows-' + fx.suffix,
      p_description:null,p_fields:[field],p_initial_row_id:rowId });
    const created=await fx.editor.client.rpc('mcp_create_table_row',{
      p_project_id:fx.projectId,p_table_id:tableId,p_requested_row_id:crypto.randomUUID(),
      p_values:{Name:'first'},p_reuse_empty:true });
    expect(created.error).toBeNull(); expect(created.data[0].row_id).toBe(rowId);
    const updated=await fx.editor.client.rpc('mcp_update_table_row',{
      p_project_id:fx.projectId,p_table_id:tableId,p_row_id:rowId,
      p_row_index:null,p_expected_row_id:rowId,p_values:{Name:'second'} });
    expect(updated.error).toBeNull(); expect(updated.data[0].name).toBe('second');
  });
});
