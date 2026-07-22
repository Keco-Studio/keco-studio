import { RLS_DB_TESTS_ENABLED, buildProjectFixture, createConfirmedOutsider,
  teardownProjectFixture, type ProjectFixture } from './helpers/rlsTestClient';

const describeDb = RLS_DB_TESTS_ENABLED ? describe : describe.skip;

describeDb('MCP consistent document read real Postgres behavior', () => {
  let fx: ProjectFixture;
  let other: ProjectFixture;

  beforeAll(async () => {
    fx = await buildProjectFixture();
    other = await buildProjectFixture();
  }, 120_000);

  afterAll(async () => {
    if (fx) await teardownProjectFixture(fx);
    if (other) await teardownProjectFixture(other);
  }, 60_000);

  async function seedDocument(fixture: ProjectFixture, label: string): Promise<string> {
    const { data, error } = await fixture.svc.from('documents').insert({
      project_id: fixture.projectId,
      name: `mcp-consistent-${label}-${fixture.suffix}`,
      content: '# Stored',
      yjs_state: 'AAAA',
      collab_epoch: 3,
      collab_revision: 7,
      created_by: fixture.owner.id,
    }).select('id').single();
    if (error || !data) throw new Error(`seed document failed: ${error?.message}`);
    return data.id as string;
  }

  it('returns ordered current-epoch updates to every current project member', async () => {
    const documentId = await seedDocument(fx, 'ordered');
    const first = crypto.randomUUID();
    const second = crypto.randomUUID();
    const ignoredEpoch = crypto.randomUUID();
    const { error } = await fx.svc.from('document_yjs_updates').insert([
      { id: second, document_id: documentId, epoch: 3, update_data: 'BBBB',
        created_at: '2026-07-22T00:00:02.000Z' },
      { id: ignoredEpoch, document_id: documentId, epoch: 2, update_data: 'CCCC',
        created_at: '2026-07-22T00:00:00.000Z' },
      { id: first, document_id: documentId, epoch: 3, update_data: 'AAAA',
        created_at: '2026-07-22T00:00:01.000Z' },
    ]);
    expect(error).toBeNull();

    for (const actor of [fx.owner, fx.admin, fx.editor, fx.viewer]) {
      const result = await actor.client.rpc('mcp_read_document_transport_state', {
        p_project_id: fx.projectId, p_document_id: documentId,
      });
      expect(result.error).toBeNull();
      expect(result.data.status).toBe('ok');
      expect(result.data.tail.map((row: { id: string }) => row.id)).toEqual([first, second]);
    }
  });

  it('denies revoked membership and does not expose cross-project documents', async () => {
    const documentId = await seedDocument(fx, 'denied');
    const otherDocumentId = await seedDocument(other, 'cross-project');
    const outsider = await fx.outsider.client.rpc('mcp_read_document_transport_state', {
      p_project_id: fx.projectId, p_document_id: documentId,
    });
    expect(outsider.error).toBeNull();
    expect(outsider.data).toEqual({ status: 'access_denied' });

    const crossProject = await fx.viewer.client.rpc('mcp_read_document_transport_state', {
      p_project_id: fx.projectId, p_document_id: otherDocumentId,
    });
    expect(crossProject.error).toBeNull();
    expect(crossProject.data).toBeNull();

    const revoked = await createConfirmedOutsider(fx, 'revoked-reader');
    expect((await fx.svc.from('project_collaborators').insert({
      project_id: fx.projectId, user_id: revoked.id, role: 'viewer',
      invited_by: fx.owner.id, invited_at: new Date().toISOString(),
      accepted_at: new Date().toISOString(),
    })).error).toBeNull();
    expect((await revoked.client.rpc('mcp_read_document_transport_state', {
      p_project_id: fx.projectId, p_document_id: documentId,
    })).data.status).toBe('ok');
    expect((await fx.svc.from('project_collaborators').delete()
      .eq('project_id', fx.projectId).eq('user_id', revoked.id)).error).toBeNull();
    expect((await revoked.client.rpc('mcp_read_document_transport_state', {
      p_project_id: fx.projectId, p_document_id: documentId,
    })).data).toEqual({ status: 'access_denied' });
  });

  it('accepts exactly 2 MiB of encoded tail and requests compaction above it', async () => {
    const documentId = await seedDocument(fx, 'payload-boundary');
    const rows = Array.from({ length: 8 }, () => ({
      id: crypto.randomUUID(), document_id: documentId, epoch: 3,
      update_data: 'A'.repeat(256 * 1024),
    }));
    expect((await fx.svc.from('document_yjs_updates').insert(rows)).error).toBeNull();
    const exact = await fx.viewer.client.rpc('mcp_read_document_transport_state', {
      p_project_id: fx.projectId, p_document_id: documentId,
    });
    expect(exact.error).toBeNull();
    expect(exact.data.status).toBe('ok');
    expect(exact.data.tail).toHaveLength(8);

    expect((await fx.svc.from('document_yjs_updates').insert({
      id: crypto.randomUUID(), document_id: documentId, epoch: 3, update_data: 'AAAA',
    })).error).toBeNull();
    const oversized = await fx.viewer.client.rpc('mcp_read_document_transport_state', {
      p_project_id: fx.projectId, p_document_id: documentId,
    });
    expect(oversized.error).toBeNull();
    expect(oversized.data).toEqual({
      status: 'payload_too_large', reason: 'compaction_required',
    });
  }, 60_000);
});
