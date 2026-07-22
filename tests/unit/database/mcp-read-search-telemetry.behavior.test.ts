import {
  RLS_DB_TESTS_ENABLED,
  buildProjectFixture,
  teardownProjectFixture,
  type ProjectFixture,
} from './helpers/rlsTestClient';

const describeDb = RLS_DB_TESTS_ENABLED ? describe : describe.skip;

describeDb('MCP read/search/telemetry real Postgres behavior', () => {
  let fx: ProjectFixture;

  beforeAll(async () => {
    fx = await buildProjectFixture();
  });

  afterAll(async () => {
    await teardownProjectFixture(fx);
  });

  it('allows members and rejects outsiders for structure reads', async () => {
    for (const client of [fx.owner.client, fx.admin.client, fx.editor.client, fx.viewer.client]) {
      const { data, error } = await client.rpc('mcp_read_project_structure', {
        p_project_id: fx.projectId,
      });
      expect(error).toBeNull();
      expect(data.project.id).toBe(fx.projectId);
    }
    const { data } = await fx.outsider.client.rpc('mcp_read_project_structure', {
      p_project_id: fx.projectId,
    });
    expect(data).toBeNull();
  });

  it('admits and completes a bounded audited read', async () => {
    const requestId = crypto.randomUUID();
    const { data, error } = await fx.viewer.client.rpc('mcp_begin_operation', {
      p_project_id: fx.projectId,
      p_operation: 'list_project_structure',
      p_operation_class: 'read',
      p_request_id: requestId,
      p_request_bytes: 100,
    });
    expect(error).toBeNull();
    expect(data[0].remaining).toBe(119);
    const completion = await fx.viewer.client.rpc('mcp_complete_operation', {
      p_operation_id: data[0].operation_id,
      p_outcome: 'succeeded',
      p_response_bytes: 200,
      p_total_ms: 5,
    });
    expect(completion.error).toBeNull();
  });

  it('allows only one completion when duplicate requests race', async () => {
    const { data: admitted, error: admissionError } = await fx.viewer.client.rpc(
      'mcp_begin_operation', {
        p_project_id: fx.projectId,
        p_operation: 'concurrent_completion_probe',
        p_operation_class: 'read',
        p_request_id: crypto.randomUUID(),
      });
    expect(admissionError).toBeNull();
    const operationId = admitted[0].operation_id as string;

    const completions = await Promise.all([
      fx.viewer.client.rpc('mcp_complete_operation', {
        p_operation_id: operationId, p_outcome: 'succeeded', p_total_ms: 1,
      }),
      fx.viewer.client.rpc('mcp_complete_operation', {
        p_operation_id: operationId, p_outcome: 'succeeded', p_total_ms: 2,
      }),
    ]);
    expect(completions.filter(result => result.error === null)).toHaveLength(1);
    expect(completions.filter(result => result.error?.code === '23505')).toHaveLength(1);

    const { count, error: countError } = await fx.svc.from('mcp_audit_events')
      .select('id', { count: 'exact', head: true })
      .eq('operation_id', operationId)
      .eq('event_type', 'completed');
    expect(countError).toBeNull();
    expect(count).toBe(1);
  });

  it('text search is project-bound and bounded', async () => {
    const { data, error } = await fx.viewer.client.rpc('mcp_text_search', {
      p_project_id: fx.projectId,
      p_query: fx.suffix,
      p_limit: 30,
    });
    expect(error).toBeNull();
    expect(data.length).toBeLessThanOrEqual(30);
    const denied = await fx.outsider.client.rpc('mcp_text_search', {
      p_project_id: fx.projectId,
      p_query: fx.suffix,
      p_limit: 10,
    });
    expect(denied.error).not.toBeNull();
  });

  it('keeps private row and document search indexes fresh after mutations', async () => {
    const fieldId = crypto.randomUUID();
    const rowId = crypto.randomUUID();
    const documentId = crypto.randomUUID();
    const oldTerm = `cobalt${crypto.randomUUID().replaceAll('-', '')}`;
    const newTerm = `vermilion${crypto.randomUUID().replaceAll('-', '')}`;
    const documentTerm = `documentneedle${fx.suffix}`;
    const setup = await Promise.all([
      fx.svc.from('library_field_definitions').insert({
        id: fieldId,
        library_id: fx.libraryId,
        section: 'main',
        section_id: 'main',
        label: 'Indexed value',
        data_type: 'string',
        order_index: 0,
      }),
      fx.svc.from('library_assets').insert({
        id: rowId,
        library_id: fx.libraryId,
        name: 'Indexed row',
        row_index: 1,
      }),
      fx.svc.from('documents').insert({
        id: documentId,
        project_id: fx.projectId,
        name: 'Indexed document',
        content: documentTerm,
        created_by: fx.owner.id,
      }),
    ]);
    expect(setup.every(result => result.error === null)).toBe(true);
    const value = await fx.svc.from('library_asset_values').insert({
      asset_id: rowId,
      field_id: fieldId,
      value_json: oldTerm,
    });
    expect(value.error).toBeNull();

    const rowSearch = await fx.viewer.client.rpc('mcp_text_search', {
      p_project_id: fx.projectId,
      p_query: oldTerm,
      p_limit: 10,
      p_source: 'tables',
    });
    expect(rowSearch.error).toBeNull();
    expect(rowSearch.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ source_type: 'library_row', source_id: rowId }),
    ]));
    const documentSearch = await fx.viewer.client.rpc('mcp_text_search', {
      p_project_id: fx.projectId,
      p_query: documentTerm,
      p_limit: 10,
      p_source: 'documents',
    });
    expect(documentSearch.error).toBeNull();
    expect(documentSearch.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ source_type: 'project_document', source_id: documentId }),
    ]));

    const updated = await fx.svc.from('library_asset_values')
      .update({ value_json: newTerm })
      .eq('asset_id', rowId)
      .eq('field_id', fieldId);
    expect(updated.error).toBeNull();
    const freshSearch = await fx.viewer.client.rpc('mcp_text_search', {
      p_project_id: fx.projectId,
      p_query: newTerm,
      p_limit: 10,
      p_source: 'tables',
    });
    expect(freshSearch.error).toBeNull();
    expect(freshSearch.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ source_type: 'library_row', source_id: rowId }),
    ]));
    const staleSearch = await fx.viewer.client.rpc('mcp_text_search', {
      p_project_id: fx.projectId,
      p_query: oldTerm,
      p_limit: 10,
      p_source: 'tables',
    });
    expect(staleSearch.error).toBeNull();
    expect(staleSearch.data).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ source_type: 'library_row', source_id: rowId }),
    ]));

    const direct = await fx.viewer.client.from('mcp_search_documents').select('*');
    expect(direct.error).not.toBeNull();
  });
});
