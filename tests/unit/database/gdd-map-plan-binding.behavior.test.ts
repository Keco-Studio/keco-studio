import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import {
  RLS_DB_TESTS_ENABLED,
  buildProjectFixture,
  teardownProjectFixture,
  type ProjectFixture,
} from './helpers/rlsTestClient';

if (process.env.REQUIRE_RLS_DB_TESTS === '1' && !RLS_DB_TESTS_ENABLED) {
  throw new Error('REQUIRE_RLS_DB_TESTS=1 requires the local RLS database suite to be enabled.');
}

const describeDb = RLS_DB_TESTS_ENABLED ? describe : describe.skip;

const plan = {
  schemaVersion: 3,
  name: 'GDD delivery island',
  summary: 'A compact delivery route map.',
  map: { width: 512, height: 512 },
  description: 'Top-down orthographic island delivery map with a harbor, roads, and a hilltop district.',
  references: [],
  styleReference: null,
  generation: { provider: 'pixellab', operation: 'create_image_pro', noBackground: false, seed: null },
};

const scene = {
  schemaVersion: 3,
  size: { width: 512, height: 512 },
  mapImage: null,
  canvas: { zoom: 1, panX: 24, panY: 24 },
};

const rules = {
  schemaVersion: 1,
  genres: ['Puzzle'],
  philosophies: ['Readable systems'],
  suitableFor: 'Map generation fixtures',
  rules: [],
  tableGuidance: [],
};

describeDb('GDD Map Plan binding (live database)', () => {
  let fx: ProjectFixture;
  let systemId = '';

  beforeAll(async () => {
    fx = await buildProjectFixture();
    const system = await fx.svc.from('game_design_systems').insert({
      owner_id: fx.owner.id,
      source: 'user',
      title: `gdd-map-plan-${fx.suffix}`,
      summary: 'Fixture design system',
      genres: ['Puzzle'],
      philosophies: ['Readable systems'],
      suitable_for: 'Map generation fixtures',
      body: '# GDD Map Plan',
      status: 'draft',
    }).select('id').single();
    if (system.error || !system.data) throw new Error(`create design system failed: ${system.error?.message}`);
    systemId = String(system.data.id);
  }, 120_000);

  afterAll(async () => {
    if (fx && systemId) {
      await fx.svc.from('projects').delete().eq('id', fx.projectId);
      await fx.svc.from('game_design_systems').delete().eq('id', systemId);
    }
    if (fx) await teardownProjectFixture(fx);
  }, 120_000);

  it('groups GDD-generated Plans and Maps in one durable conversation', async () => {
    const version = await fx.svc.from('game_design_system_versions').insert({
      system_id: systemId,
      version_number: 1,
      rules,
      rendered_markdown: '# GDD Map Plan',
      source_snapshots: [],
      diff: { added: [], removed: [], changed: [], conflicts: [] },
      conflicts: [],
      content_hash: 'a'.repeat(64),
      created_by: fx.owner.id,
    }).select('id').single();
    if (version.error || !version.data) throw new Error(`create design system version failed: ${version.error?.message}`);

    const job = await fx.svc.from('gdd_generation_jobs').insert({
      owner_id: fx.owner.id,
      project_id: fx.projectId,
      design_system_id: systemId,
      version_id: version.data.id,
      input: {},
      source_snapshots: [],
      status: 'waiting_for_maps',
      phase: 'generating_maps',
      resource_mode: 'async',
    }).select('id').single();
    if (job.error || !job.data) throw new Error(`create GDD job failed: ${job.error?.message}`);

    const document = await fx.svc.from('documents').insert({
      project_id: fx.projectId,
      name: `gdd-map-source-${fx.suffix}`,
      content: '# GDD',
      created_by: fx.owner.id,
      gdd_generation_job_id: job.data.id,
    }).select('id,updated_at,collab_epoch,collab_revision').single();
    if (document.error || !document.data) throw new Error(`create GDD document failed: ${document.error?.message}`);

    const setOutput = await fx.svc.from('gdd_generation_jobs')
      .update({ output_document_id: document.data.id })
      .eq('id', job.data.id);
    if (setOutput.error) throw new Error(`bind GDD document failed: ${setOutput.error.message}`);

    const workerId = `gdd-map-worker-${fx.suffix}`;
    const artifact = await fx.svc.from('gdd_map_artifacts').insert({
      id: randomUUID(),
      gdd_generation_job_id: job.data.id,
      gdd_document_id: document.data.id,
      project_id: fx.projectId,
      owner_id: fx.owner.id,
      design_system_id: systemId,
      version_id: version.data.id,
      map_brief_id: randomUUID(),
      title: 'GDD delivery island',
      map_brief: { title: 'GDD delivery island' },
      input_hash: 'b'.repeat(64),
      status: 'running',
      phase: 'planning',
      lease_owner: workerId,
      lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
    }).select('id').single();
    if (artifact.error || !artifact.data) throw new Error(`create map artifact failed: ${artifact.error?.message}`);

    const prepared = await fx.svc.rpc('prepare_gdd_map_artifact', {
      p_artifact_id: artifact.data.id,
      p_worker_id: workerId,
      p_plan: plan,
      p_scene: scene,
      p_generation_id: randomUUID(),
      p_plan_fingerprint: 'c'.repeat(64),
    });
    expect(prepared.error).toBeNull();
    const result = (prepared.data as Array<{
      map_id: string;
      generation_revision_id: string;
      draft_revision_id: string;
      asset_id: string;
    }>)[0];

    const [generatedRevision, nextDraft, savedPlan, map, persistedArtifact, planNode] = await Promise.all([
      fx.svc.from('map_revisions').select('id,status,plan_version_id').eq('id', result.generation_revision_id).single(),
      fx.svc.from('map_revisions').select('id,status').eq('id', result.draft_revision_id).single(),
      fx.svc.from('map_plan_versions')
        .select('id,draft_revision_id,draft_save_version,plan_version_number')
        .eq('map_project_id', result.map_id)
        .single(),
      fx.svc.from('map_projects').select('current_revision_id').eq('id', result.map_id).single(),
      fx.svc.from('gdd_map_artifacts').select('status,phase,map_project_id,map_revision_id,map_asset_id').eq('id', artifact.data.id).single(),
      fx.svc.from('map_conversation_nodes')
        .select('id,conversation_id,plan_display_version,map_project_id,map_plan_version_id')
        .eq('map_project_id', result.map_id)
        .eq('node_type', 'plan')
        .single(),
    ]);

    expect(generatedRevision.error).toBeNull();
    expect(generatedRevision.data).toMatchObject({
      id: result.generation_revision_id,
      status: 'generating',
    });
    expect(generatedRevision.data?.plan_version_id).toBeTruthy();
    expect(savedPlan.error).toBeNull();
    expect(savedPlan.data).toMatchObject({
      id: generatedRevision.data?.plan_version_id,
      draft_revision_id: result.generation_revision_id,
      draft_save_version: 0,
      plan_version_number: 1,
    });
    expect(nextDraft.data).toMatchObject({ id: result.draft_revision_id, status: 'draft' });
    expect(map.data?.current_revision_id).toBe(result.draft_revision_id);
    expect(persistedArtifact.data).toMatchObject({
      status: 'queued',
      phase: 'submitting',
      map_project_id: result.map_id,
      map_revision_id: result.generation_revision_id,
      map_asset_id: result.asset_id,
    });
    expect(planNode.error).toBeNull();
    expect(planNode.data).toMatchObject({
      map_project_id: result.map_id,
      map_plan_version_id: savedPlan.data?.id,
      plan_display_version: 1,
    });

    const pendingConversation = await fx.owner.client.rpc('read_map_conversation_v1', {
      p_conversation_id: planNode.data?.conversation_id,
    });
    expect(pendingConversation.error).toBeNull();
    expect(pendingConversation.data).toMatchObject({
      nodes: [expect.objectContaining({ id: planNode.data?.id, type: 'plan' })],
    });
    expect((pendingConversation.data as { nodes: Array<{ type: string }> }).nodes)
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ type: 'map' })]));

    const secondArtifact = await fx.svc.from('gdd_map_artifacts').insert({
      id: randomUUID(),
      gdd_generation_job_id: job.data.id,
      gdd_document_id: document.data.id,
      project_id: fx.projectId,
      owner_id: fx.owner.id,
      design_system_id: systemId,
      version_id: version.data.id,
      map_brief_id: randomUUID(),
      title: 'GDD delivery island revision',
      map_brief: { title: 'GDD delivery island revision' },
      input_hash: 'd'.repeat(64),
      status: 'running',
      phase: 'planning',
      lease_owner: workerId,
      lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
    }).select('id').single();
    if (secondArtifact.error || !secondArtifact.data) throw new Error(`create second map artifact failed: ${secondArtifact.error?.message}`);

    const secondPrepared = await fx.svc.rpc('prepare_gdd_map_artifact', {
      p_artifact_id: secondArtifact.data.id,
      p_worker_id: workerId,
      p_plan: { ...plan, name: 'GDD delivery island revision' },
      p_scene: scene,
      p_generation_id: randomUUID(),
      p_plan_fingerprint: 'e'.repeat(64),
    });
    expect(secondPrepared.error).toBeNull();
    const secondResult = (secondPrepared.data as Array<{ map_id: string }>)[0];

    const groupedPlans = await fx.svc.from('map_conversation_nodes')
      .select('conversation_id,plan_display_version,map_project_id')
      .in('map_project_id', [result.map_id, secondResult.map_id])
      .eq('node_type', 'plan')
      .order('plan_display_version');
    expect(groupedPlans.error).toBeNull();
    expect(groupedPlans.data).toEqual([
      expect.objectContaining({
        conversation_id: planNode.data?.conversation_id,
        plan_display_version: 1,
        map_project_id: result.map_id,
      }),
      expect.objectContaining({
        conversation_id: planNode.data?.conversation_id,
        plan_display_version: 2,
        map_project_id: secondResult.map_id,
      }),
    ]);

    for (const [expectedStatus, nextStatus] of [
      ['planned', 'queued'],
      ['queued', 'generating'],
    ] as const) {
      const transition = await fx.svc.rpc('transition_map_asset', {
        p_asset_id: result.asset_id,
        p_expected_status: expectedStatus,
        p_next_status: nextStatus,
        p_provider_operation: 'create_image_pro',
        p_provider_transport: 'mcp',
        p_provider_job_id: 'gdd-map-plan-binding-job',
        p_last_error_code: null,
        p_storage_path: null,
        p_sha256: null,
        p_width: null,
        p_height: null,
        p_has_transparency: null,
        p_metadata: {},
      });
      if (transition.error) throw new Error(`transition map asset failed: ${transition.error.message}`);
    }
    const sha256 = '1'.repeat(64);
    const makeAssetReady = await fx.svc.rpc('transition_map_asset', {
      p_asset_id: result.asset_id,
      p_expected_status: 'generating',
      p_next_status: 'ready',
      p_provider_operation: 'create_image_pro',
      p_provider_transport: 'mcp',
      p_provider_job_id: 'gdd-map-plan-binding-job',
      p_last_error_code: null,
      p_storage_path: `${fx.projectId}/${result.map_id}/${result.generation_revision_id}/map-image/${sha256}.png`,
      p_sha256: sha256,
      p_width: 512,
      p_height: 512,
      p_has_transparency: false,
      p_metadata: {},
    });
    if (makeAssetReady.error) throw new Error(`mark map asset ready failed: ${makeAssetReady.error.message}`);
    const resumeArtifact = await fx.svc.from('gdd_map_artifacts')
      .update({
        status: 'running',
        phase: 'validating',
        lease_owner: workerId,
        lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
      })
      .eq('id', artifact.data.id);
    if (resumeArtifact.error) throw new Error(`resume artifact failed: ${resumeArtifact.error.message}`);
    const finished = await fx.svc.rpc('finish_gdd_map_artifact', {
      p_artifact_id: artifact.data.id,
      p_worker_id: workerId,
      p_status: 'ready',
      p_error: null,
    });
    expect(finished.error).toBeNull();
    const mapNode = await fx.svc.from('map_conversation_nodes')
      .select('parent_plan_node_id,map_revision_id,map_asset_id')
      .eq('parent_plan_node_id', planNode.data?.id ?? '')
      .eq('node_type', 'map')
      .single();
    expect(mapNode.error).toBeNull();
    expect(mapNode.data).toMatchObject({
      parent_plan_node_id: planNode.data?.id,
      map_revision_id: result.generation_revision_id,
      map_asset_id: result.asset_id,
    });

    const readyConversation = await fx.owner.client.rpc('read_map_conversation_v1', {
      p_conversation_id: planNode.data?.conversation_id,
    });
    expect(readyConversation.error).toBeNull();
    expect(readyConversation.data).toMatchObject({
      nodes: expect.arrayContaining([
        expect.objectContaining({
          type: 'map',
          planNodeId: planNode.data?.id,
          revisionId: result.generation_revision_id,
          assetId: result.asset_id,
          mapVersionNumber: 1,
          status: 'ready',
        }),
      ]),
    });

    const followUp = await fx.owner.client.rpc('create_map_conversation_plan_v1', {
      p_project_id: fx.projectId,
      p_conversation_id: planNode.data?.conversation_id,
      p_parent_plan_node_id: planNode.data?.id,
      p_title: 'GDD delivery island',
      p_message: 'Move the harbor clinic closer to the route.',
      p_idempotency_key: randomUUID(),
      p_intent_hash: 'f'.repeat(64),
      p_name: 'GDD delivery island clinic revision',
      p_source_document_id: document.data.id,
      p_source_document_updated_at: document.data.updated_at ?? null,
      p_source_epoch: document.data.collab_epoch ?? null,
      p_source_revision: document.data.collab_revision ?? null,
      p_plan: { ...plan, name: 'GDD delivery island clinic revision' },
      p_scene: scene,
    });
    expect(followUp.error).toBeNull();
  }, 120_000);
});
