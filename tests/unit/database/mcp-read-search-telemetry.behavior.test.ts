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
});
