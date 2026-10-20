import { randomUUID } from 'node:crypto';
import { RLS_DB_TESTS_ENABLED, buildProjectFixture, teardownProjectFixture,
  type ProjectFixture } from './helpers/rlsTestClient';
import { createAgentStructuredGameDesignSystem, IdempotencyConflictError } from
  '@/lib/services/gameDesignSystemService';

const describeDb = RLS_DB_TESTS_ENABLED ? describe : describe.skip;

describeDb('agent create request idempotency (live database)', () => {
  let fx: ProjectFixture;

  beforeAll(async () => { fx = await buildProjectFixture(); }, 120_000);
  afterAll(async () => { if (fx) await teardownProjectFixture(fx); }, 60_000);

  it('creates one structured system per actor and request key', async () => {
    const idempotencyKey = randomUUID();
    const input = { idempotencyKey, title: 'Agent rules', rules: {
      schemaVersion: 1, genres: ['Strategy'], philosophies: [], suitableFor: 'Teams',
      rules: [{ id: 'clear-decisions', kind: 'principle', title: 'Clear decisions',
        statement: 'Show the cost before commitment.', appliesWhen: 'Every choice', severity: 'required' }],
      tableGuidance: [],
    } };
    const [first, replay] = await Promise.all([
      createAgentStructuredGameDesignSystem(fx.svc, fx.owner.id, input),
      createAgentStructuredGameDesignSystem(fx.svc, fx.owner.id, input),
    ]);
    expect(replay.id).toBe(first.id);
    expect(replay.current_version_id).toBe(first.current_version_id);
    await expect(createAgentStructuredGameDesignSystem(fx.svc, fx.owner.id,
      { ...input, title: 'Different rules' })).rejects.toBeInstanceOf(IdempotencyConflictError);
    const removed = await fx.svc.from('game_design_systems').delete().eq('id', first.id);
    expect(removed.error).toBeNull();
    await expect(createAgentStructuredGameDesignSystem(fx.svc, fx.owner.id, input))
      .rejects.toThrow();
  });

  it('replays Studio create IDs and keeps request keys after deletion', async () => {
    const idempotencyKey = randomUUID();
    const inputHash = 'a'.repeat(64);
    const folder = await fx.owner.client.from('folders').insert({ project_id: fx.projectId,
      name: `agent-folder-${fx.suffix}`, agent_create_key: idempotencyKey,
      agent_create_hash: inputHash }).select('id').single();
    expect(folder.error).toBeNull();
    const library = await fx.owner.client.from('libraries').insert({ project_id: fx.projectId,
      name: `agent-library-${fx.suffix}`, agent_create_key: idempotencyKey,
      agent_create_hash: inputHash }).select('id').single();
    expect(library.error).toBeNull();

    for (const [operation, resourceId] of [
      ['folder', folder.data!.id], ['library', library.data!.id],
    ] as const) {
      const replay = await fx.owner.client.rpc('get_agent_studio_create_request', {
        p_project_id: fx.projectId, p_operation: operation,
        p_idempotency_key: idempotencyKey, p_input_hash: inputHash,
      });
      expect(replay.error).toBeNull();
      expect(replay.data).toBe(resourceId);
    }

    const removed = await fx.svc.from('folders').delete().eq('id', folder.data!.id);
    expect(removed.error).toBeNull();
    const deletedReplay = await fx.owner.client.rpc('get_agent_studio_create_request', {
      p_project_id: fx.projectId, p_operation: 'folder',
      p_idempotency_key: idempotencyKey, p_input_hash: inputHash,
    });
    expect(deletedReplay.error?.message).toContain('IDEMPOTENCY_OUTPUT_DELETED');
    const reuse = await fx.owner.client.from('folders').insert({ project_id: fx.projectId,
      name: `agent-folder-retry-${fx.suffix}`, agent_create_key: idempotencyKey,
      agent_create_hash: inputHash });
    expect(reuse.error?.code).toBe('23505');
  });

  it('replays a document version after its snapshot changes and reserves deleted IDs', async () => {
    const document = await fx.svc.from('documents').insert({ project_id: fx.projectId,
      name: `agent-version-${fx.suffix}`, content: '# Initial', created_by: fx.owner.id })
      .select('id').single();
    expect(document.error).toBeNull();
    const initialized = await fx.owner.client.rpc('initialize_document_collab_state', {
      p_document_id: document.data!.id, p_expected_epoch: 0,
      p_yjs_state: 'AQID', p_markdown: '# Initial',
    });
    expect(initialized.error).toBeNull();
    const versionId = randomUUID();
    const args = { p_version_id: versionId, p_document_id: document.data!.id,
      p_expected_epoch: 0, p_expected_revision: 1, p_included_update_ids: [],
      p_name: 'Agent checkpoint', p_yjs_state: 'AQID', p_markdown: '# Initial' };
    const created = await fx.owner.client.rpc('create_document_version', args);
    expect(created.error).toBeNull();
    const replay = await fx.owner.client.rpc('get_document_version_create_request', {
      p_version_id: versionId, p_document_id: document.data!.id, p_name: 'Agent checkpoint',
    });
    expect(replay.error).toBeNull();
    expect(replay.data?.[0]?.version_id).toBe(versionId);
    const removed = await fx.svc.from('document_versions').delete().eq('id', versionId);
    expect(removed.error).toBeNull();
    const reuse = await fx.owner.client.rpc('create_document_version', args);
    expect(reuse.error?.code).toBe('23505');
  });
});
