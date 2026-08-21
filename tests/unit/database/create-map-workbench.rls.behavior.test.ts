import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  RLS_DB_TESTS_ENABLED,
  anonClient,
  buildProjectFixture,
  createConfirmedOutsider,
  teardownProjectFixture,
  type ProjectFixture,
  type RlsUser,
} from './helpers/rlsTestClient';

const describeDb = RLS_DB_TESTS_ENABLED ? describe : describe.skip;
const sourceTime = '2026-08-08T08:00:00.000Z';
const plan = { schemaVersion: 1, name: 'Live map plan' };
const scene = { schemaVersion: 1, layers: [] };
const planV2 = { schemaVersion: 2, name: 'Description-only V2 map' };
const sceneV2 = { schemaVersion: 2, background: null, layers: [], obstacleEntities: [] };
const planV3 = {
  schemaVersion: 3,
  name: 'Direct-image V3 map',
  summary: 'A compact village map generated as one image.',
  map: { width: 512, height: 512 },
  description: 'Top-down orthographic pixel-art village with clear roads, fields, trees, and a central square.',
  references: [],
  styleReference: null,
  generation: { provider: 'pixellab', operation: 'create_image_pro', noBackground: false, seed: null },
};
const sceneV3 = {
  schemaVersion: 3,
  size: { width: 512, height: 512 },
  mapImage: null,
  canvas: { zoom: 1, panX: 24, panY: 24 },
};

type CreatedMap = { map_id: string; draft_revision_id: string; revision_number: number; save_version: number };

describeDb('Create Map RLS and atomic RPCs (live database)', () => {
  let fx: ProjectFixture;
  let pending: RlsUser;
  let documentId: string;

  beforeAll(async () => {
    fx = await buildProjectFixture();
    pending = await createConfirmedOutsider(fx, 'pending-map');
    const now = new Date().toISOString();
    expect((await fx.svc.from('project_collaborators').insert({
      user_id: pending.id,
      project_id: fx.projectId,
      role: 'editor',
      invited_by: fx.owner.id,
      invited_at: now,
      accepted_at: null,
    })).error).toBeNull();
    const document = await fx.svc.from('documents').insert({
      project_id: fx.projectId,
      name: `map-source-${fx.suffix}`,
      content: '# Village',
      created_by: fx.owner.id,
    }).select('id').single();
    if (document.error || !document.data) throw new Error(`source document failed: ${document.error?.message}`);
    documentId = document.data.id as string;
  }, 120_000);

  afterEach(async () => {
    if (fx) await fx.svc.from('map_projects').delete().eq('project_id', fx.projectId);
  });

  afterAll(async () => {
    if (fx) await teardownProjectFixture(fx);
  }, 60_000);

  function createMap(client: SupabaseClient, name = 'Live map') {
    return client.rpc('create_map_project', {
      p_project_id: fx.projectId,
      p_name: name,
      p_source_document_id: documentId,
      p_source_document_updated_at: sourceTime,
      p_source_epoch: 1,
      p_source_revision: 1,
      p_plan: plan,
      p_scene: scene,
    });
  }

  async function created(client: SupabaseClient): Promise<CreatedMap> {
    const result = await createMap(client);
    expect(result.error).toBeNull();
    return (result.data as CreatedMap[])[0];
  }

  it('allows owner/admin/editor mutations, viewer reads, and rejects all other writers', async () => {
    for (const actor of [fx.owner, fx.admin, fx.editor]) {
      expect((await createMap(actor.client, `map-${actor.id}`)).error).toBeNull();
    }
    const visible = await fx.viewer.client.from('map_projects').select('id').eq('project_id', fx.projectId);
    expect(visible.error).toBeNull();
    expect(visible.data).toHaveLength(3);

    for (const client of [fx.viewer.client, fx.outsider.client, pending.client, anonClient()]) {
      expect((await createMap(client)).error?.code).toBe('42501');
    }
    const outsiderRead = await fx.outsider.client.from('map_projects').select('id').eq('project_id', fx.projectId);
    expect(outsiderRead.error).toBeNull();
    expect(outsiderRead.data).toEqual([]);

    expect((await fx.owner.client.from('map_projects').insert({
      project_id: fx.projectId,
      name: 'direct write',
      created_by: fx.owner.id,
    })).error).not.toBeNull();
  });

  it('allows an all-null V2 source tuple and rejects V1 payloads at V2 RPCs', async () => {
    const createdV2 = await fx.owner.client.rpc('create_map_project_v2', {
      p_project_id: fx.projectId,
      p_name: planV2.name,
      p_source_document_id: null,
      p_source_document_updated_at: null,
      p_source_epoch: null,
      p_source_revision: null,
      p_plan: planV2,
      p_scene: sceneV2,
    });
    expect(createdV2.error).toBeNull();
    const createdRow = (createdV2.data as CreatedMap[])[0];

    const revision = await fx.svc.from('map_revisions')
      .select('schema_version,source_document_id,source_document_updated_at,source_epoch,source_revision')
      .eq('id', createdRow.draft_revision_id)
      .single();
    expect(revision.error).toBeNull();
    expect(revision.data).toEqual({
      schema_version: 2,
      source_document_id: null,
      source_document_updated_at: null,
      source_epoch: null,
      source_revision: null,
    });

    const invalidPayload = await fx.owner.client.rpc('save_map_draft_v2', {
      p_map_id: createdRow.map_id,
      p_revision_id: createdRow.draft_revision_id,
      p_expected_save_version: 0,
      p_plan: plan,
      p_scene: scene,
    });
    expect(invalidPayload.error?.code).toBe('22023');

    const viewerCreate = await fx.viewer.client.rpc('create_map_project_v2', {
      p_project_id: fx.projectId,
      p_name: 'Denied V2 map',
      p_source_document_id: null,
      p_source_document_updated_at: null,
      p_source_epoch: null,
      p_source_revision: null,
      p_plan: planV2,
      p_scene: sceneV2,
    });
    expect(viewerCreate.error?.code).toBe('42501');
  });

  it('allows V3 owner/editor mutations, rejects non-writers, and rejects V2 payloads', async () => {
    const createV3 = (client: SupabaseClient, name: string, nextPlan: object = planV3, nextScene: object = sceneV3) => client.rpc('create_map_project_v3', {
      p_project_id: fx.projectId,
      p_name: name,
      p_source_document_id: null,
      p_source_document_updated_at: null,
      p_source_epoch: null,
      p_source_revision: null,
      p_plan: nextPlan,
      p_scene: nextScene,
    });

    const ownerCreate = await createV3(fx.owner.client, 'Owner V3 map');
    expect(ownerCreate.error).toBeNull();
    expect((await createV3(fx.editor.client, 'Editor V3 map')).error).toBeNull();

    for (const client of [fx.viewer.client, fx.outsider.client, pending.client, anonClient()]) {
      expect((await createV3(client, 'Denied V3 map')).error?.code).toBe('42501');
    }

    expect((await createV3(fx.owner.client, 'Invalid V3 map', planV2, sceneV2)).error?.code).toBe('22023');
    expect((await createV3(fx.owner.client, 'String Plan schema version', { ...planV3, schemaVersion: '3' }, sceneV3)).error?.code).toBe('22023');
    expect((await createV3(fx.owner.client, 'String Scene schema version', planV3, { ...sceneV3, schemaVersion: '3' })).error?.code).toBe('22023');
    const invalidShapes: Array<[string, object, object]> = [
      ['Extra Plan credential', { ...planV3, apiToken: 'must-not-persist' }, sceneV3],
      ['Extra generation field', { ...planV3, generation: { ...planV3.generation, callbackUrl: 'https://example.test' } }, sceneV3],
      ['Extra reference field', { ...planV3, references: [{
        assetId: '10000000-0000-4000-8000-000000000001', sha256: 'a'.repeat(64),
        role: 'layout', usage: 'Layout guide', signedUrl: 'https://example.test/reference.png',
      }] }, sceneV3],
      ['Extra Scene field', planV3, { ...sceneV3, providerResponse: { secret: true } }],
      ['Malformed canvas', planV3, { ...sceneV3, canvas: { zoom: 0, panX: 24, panY: 24 } }],
      ['Malformed map image', planV3, { ...sceneV3, mapImage: {
        assetKey: 'map-image', sourceRevisionId: 'not-a-uuid', width: 512, height: 512, locked: true,
      } }],
    ];
    for (const [name, nextPlan, nextScene] of invalidShapes) {
      const rejected = await createV3(fx.owner.client, name, nextPlan, nextScene);
      expect([name, rejected.error?.code]).toEqual([name, '22023']);
    }

    const ownerMap = (ownerCreate.data as CreatedMap[])[0];
    const invalidSave = await fx.owner.client.rpc('save_map_draft_v3', {
      p_map_id: ownerMap.map_id,
      p_revision_id: ownerMap.draft_revision_id,
      p_expected_save_version: 0,
      p_plan: planV2,
      p_scene: sceneV2,
    });
    expect(invalidSave.error?.code).toBe('22023');
  });

  it('creates V3 maps idempotently per actor and rejects changed replays or viewers', async () => {
    const key = crypto.randomUUID();
    const createIdempotent = (
      client: SupabaseClient,
      inputHash: string,
      name = 'Idempotent V3 map',
    ) => client.rpc('create_map_project_v3_idempotent', {
      p_project_id: fx.projectId,
      p_idempotency_key: key,
      p_input_hash: inputHash,
      p_name: name,
      p_source_document_id: null,
      p_source_document_updated_at: null,
      p_source_epoch: null,
      p_source_revision: null,
      p_plan: planV3,
      p_scene: sceneV3,
    });

    const first = await createIdempotent(fx.owner.client, 'a'.repeat(64));
    const replay = await createIdempotent(fx.owner.client, 'a'.repeat(64));
    expect(first.error).toBeNull();
    expect(replay.error).toBeNull();
    expect(replay.data).toEqual(first.data);

    const created = (first.data as CreatedMap[])[0];
    const rows = await fx.svc.from('map_projects').select('id').eq('id', created.map_id);
    expect(rows.error).toBeNull();
    expect(rows.data).toHaveLength(1);

    const conflict = await createIdempotent(
      fx.owner.client,
      'b'.repeat(64),
      'Changed map',
    );
    expect(conflict.error?.code).toBe('KM409');

    const editor = await fx.editor.client.rpc('create_map_project_v3_idempotent', {
      p_project_id: fx.projectId,
      p_idempotency_key: crypto.randomUUID(),
      p_input_hash: 'c'.repeat(64),
      p_name: 'Editor idempotent V3 map',
      p_source_document_id: null,
      p_source_document_updated_at: null,
      p_source_epoch: null,
      p_source_revision: null,
      p_plan: planV3,
      p_scene: sceneV3,
    });
    expect(editor.error).toBeNull();

    const viewer = await fx.viewer.client.rpc('create_map_project_v3_idempotent', {
      p_project_id: fx.projectId,
      p_idempotency_key: crypto.randomUUID(),
      p_input_hash: 'd'.repeat(64),
      p_name: 'Denied idempotent V3 map',
      p_source_document_id: null,
      p_source_document_updated_at: null,
      p_source_epoch: null,
      p_source_revision: null,
      p_plan: planV3,
      p_scene: sceneV3,
    });
    expect(viewer.error?.code).toBe('42501');
  });

  it('exposes V3 reference registry rows only to accepted Project members', async () => {
    const reference = await fx.svc.from('map_reference_images').insert({
      project_id: fx.projectId,
      name: 'Village layout',
      storage_path: `${fx.projectId}/references/${fx.suffix}.png`,
      sha256: 'd'.repeat(64),
      width: 512,
      height: 512,
      content_type: 'image/png',
      byte_size: 1024,
      created_by: fx.owner.id,
    }).select('id').single();
    expect(reference.error).toBeNull();
    const referenceId = reference.data!.id as string;

    for (const client of [fx.owner.client, fx.admin.client, fx.editor.client, fx.viewer.client]) {
      const visible = await client.from('map_reference_images').select('id').eq('id', referenceId);
      expect(visible.error).toBeNull();
      expect(visible.data).toEqual([{ id: referenceId }]);
    }
    for (const client of [fx.outsider.client, pending.client]) {
      const hidden = await client.from('map_reference_images').select('id').eq('id', referenceId);
      expect(hidden.error).toBeNull();
      expect(hidden.data).toEqual([]);
    }

    const anonymous = await anonClient().from('map_reference_images').select('id').eq('id', referenceId);
    expect(anonymous.error).not.toBeNull();
  });

  it('exposes saved-map list and current Revision reads only to Project members', async () => {
    const map = await created(fx.owner.client);

    const ownerList = await fx.owner.client.from('map_projects')
      .select('id, project_id, name, current_revision_id, updated_at, projects!map_projects_project_id_fkey(name)')
      .eq('id', map.map_id);
    expect(ownerList.error).toBeNull();
    expect(ownerList.data).toHaveLength(1);
    expect(ownerList.data?.[0]).toMatchObject({
      id: map.map_id,
      project_id: fx.projectId,
      current_revision_id: map.draft_revision_id,
    });

    const collaboratorOpen = await fx.viewer.client.from('map_revisions')
      .select('id, revision_number, save_version, source_document_id, plan, scene')
      .eq('id', map.draft_revision_id)
      .single();
    expect(collaboratorOpen.error).toBeNull();
    expect(collaboratorOpen.data?.id).toBe(map.draft_revision_id);

    const outsiderList = await fx.outsider.client.from('map_projects')
      .select('id')
      .eq('id', map.map_id);
    expect(outsiderList.error).toBeNull();
    expect(outsiderList.data).toEqual([]);
  });

  it('allows exactly one compare-and-swap draft save', async () => {
    const map = await created(fx.owner.client);
    const contenders = [
      { ...scene, marker: 'first' },
      { ...scene, marker: 'second' },
    ];
    const results = await Promise.all(contenders.map((nextScene) => fx.owner.client.rpc('save_map_draft', {
      p_map_id: map.map_id,
      p_revision_id: map.draft_revision_id,
      p_expected_save_version: 0,
      p_plan: plan,
      p_scene: nextScene,
    })));
    expect(results.map((result) => result.error)).toEqual([null, null]);
    const rows = results.flatMap((result) => result.data as Array<{ status: string; save_version: number | null }>);
    expect(rows.filter((row) => row.status === 'saved')).toHaveLength(1);
    expect(rows.filter((row) => row.status === 'conflict')).toEqual([{ status: 'conflict', save_version: null }]);
  });

  it('keeps published payloads immutable and successful siblings ready across retry', async () => {
    const map = await created(fx.owner.client);
    const published = await fx.owner.client.rpc('publish_map_revision', {
      p_map_id: map.map_id,
      p_draft_revision_id: map.draft_revision_id,
      p_expected_save_version: 0,
    });
    expect(published.error).toBeNull();
    const revisionId = published.data[0].published_revision_id as string;
    expect((await fx.svc.from('map_revisions').update({ plan: { changed: true } }).eq('id', revisionId)).error?.code).toBe('23514');
    expect((await fx.svc.from('map_revisions').update({ status: 'draft' }).eq('id', revisionId)).error?.code).toBe('23514');

    const createAsset = (key: string) => fx.owner.client.rpc('create_map_asset_plan', {
      p_revision_id: revisionId,
      p_asset_key: key,
      p_kind: 'object',
      p_prompt: `Generate ${key}`,
      p_requested_capability: 'create_map_object',
      p_generation_params: {},
      p_reference_asset_ids: [],
      p_reference_hashes: [],
      p_metadata: {},
    });
    const first = await createAsset('oak-tree');
    const duplicate = await createAsset('oak-tree');
    const second = await createAsset('stone-well');
    expect(first.error).toBeNull();
    expect(duplicate.data[0].asset_id).toBe(first.data[0].asset_id);

    const transition = (assetId: string, from: string, to: string, ready = false) => fx.svc.rpc('transition_map_asset', {
      p_asset_id: assetId,
      p_expected_status: from,
      p_next_status: to,
      p_provider_operation: 'test',
      p_provider_transport: 'rest',
      p_provider_job_id: 'test-job',
      p_last_error_code: to === 'failed' ? 'provider_failed' : null,
      p_storage_path: ready ? `${fx.projectId}/${map.map_id}/${revisionId}/oak-tree/${'a'.repeat(64)}.png` : null,
      p_sha256: ready ? 'a'.repeat(64) : null,
      p_width: ready ? 64 : null,
      p_height: ready ? 80 : null,
      p_has_transparency: ready ? true : null,
      p_metadata: ready ? { completed: true } : {},
    });
    const firstId = first.data[0].asset_id as string;
    const secondId = second.data[0].asset_id as string;
    expect((await transition(firstId, 'planned', 'queued')).data[0].attempt_count).toBe(1);
    expect((await transition(firstId, 'queued', 'generating')).error).toBeNull();
    expect((await transition(firstId, 'generating', 'ready', true)).error).toBeNull();
    expect((await transition(secondId, 'planned', 'queued')).error).toBeNull();
    expect((await transition(secondId, 'queued', 'generating')).error).toBeNull();
    expect((await transition(secondId, 'generating', 'failed')).error).toBeNull();
    expect((await transition(secondId, 'failed', 'queued')).data[0].attempt_count).toBe(2);

    const assets = await fx.svc.from('map_assets').select('id,status').eq('map_revision_id', revisionId);
    expect(assets.data?.find((asset) => asset.id === firstId)?.status).toBe('ready');
    expect(assets.data).toHaveLength(2);

    const duplicateAfterRuntimeMetadata = await createAsset('oak-tree');
    expect(duplicateAfterRuntimeMetadata.error).toBeNull();
    expect(duplicateAfterRuntimeMetadata.data[0].asset_id).toBe(firstId);
  });

  it('serializes concurrent sibling completion before settling revision status', async () => {
    const map = await created(fx.owner.client);
    const published = await fx.owner.client.rpc('publish_map_revision', {
      p_map_id: map.map_id,
      p_draft_revision_id: map.draft_revision_id,
      p_expected_save_version: 0,
    });
    expect(published.error).toBeNull();
    const revisionId = published.data[0].published_revision_id as string;

    const assetIds: string[] = [];
    for (const key of ['north-gate', 'south-gate']) {
      const createdAsset = await fx.owner.client.rpc('create_map_asset_plan', {
        p_revision_id: revisionId,
        p_asset_key: key,
        p_kind: 'object',
        p_prompt: `Generate ${key}`,
        p_requested_capability: 'create_map_object',
        p_generation_params: {},
        p_reference_asset_ids: [],
        p_reference_hashes: [],
        p_metadata: {},
      });
      expect(createdAsset.error).toBeNull();
      const assetId = createdAsset.data[0].asset_id as string;
      assetIds.push(assetId);
      for (const [from, to] of [['planned', 'queued'], ['queued', 'generating']] as const) {
        const transition = await fx.svc.rpc('transition_map_asset', {
          p_asset_id: assetId,
          p_expected_status: from,
          p_next_status: to,
          p_provider_operation: 'test',
          p_provider_transport: 'rest',
          p_provider_job_id: `job-${key}`,
          p_last_error_code: null,
          p_storage_path: null,
          p_sha256: null,
          p_width: null,
          p_height: null,
          p_has_transparency: null,
          p_metadata: {},
        });
        expect(transition.error).toBeNull();
      }
    }

    const completions = await Promise.all(assetIds.map((assetId, index) => {
      const key = index === 0 ? 'north-gate' : 'south-gate';
      const hash = index === 0 ? 'b'.repeat(64) : 'c'.repeat(64);
      return fx.svc.rpc('transition_map_asset', {
        p_asset_id: assetId,
        p_expected_status: 'generating',
        p_next_status: 'ready',
        p_provider_operation: 'test',
        p_provider_transport: 'rest',
        p_provider_job_id: `job-${key}`,
        p_last_error_code: null,
        p_storage_path: `${fx.projectId}/${map.map_id}/${revisionId}/${key}/${hash}.png`,
        p_sha256: hash,
        p_width: 64,
        p_height: 80,
        p_has_transparency: true,
        p_metadata: { completed: true },
      });
    }));
    expect(completions.map((result) => result.error)).toEqual([null, null]);

    const revision = await fx.svc.from('map_revisions').select('status').eq('id', revisionId).single();
    expect(revision.error).toBeNull();
    expect(revision.data?.status).toBe('ready');
  });

  it('cascades maps, revisions, and assets with their project', async () => {
    const extraProject = await fx.svc.from('projects').insert({
      owner_id: fx.owner.id,
      name: `map-cascade-${fx.suffix}`,
      description: 'map cascade',
    }).select('id').single();
    expect(extraProject.error).toBeNull();
    const projectId = extraProject.data!.id as string;
    const document = await fx.svc.from('documents').insert({ project_id: projectId, name: 'Map source', content: '# Map', created_by: fx.owner.id }).select('id').single();
    expect(document.error).toBeNull();
    const map = await fx.owner.client.rpc('create_map_project', {
      p_project_id: projectId,
      p_name: 'Cascade map',
      p_source_document_id: document.data!.id,
      p_source_document_updated_at: sourceTime,
      p_source_epoch: 1,
      p_source_revision: 1,
      p_plan: plan,
      p_scene: scene,
    });
    expect(map.error).toBeNull();
    expect((await fx.svc.from('projects').delete().eq('id', projectId)).error).toBeNull();
    expect((await fx.svc.from('map_projects').select('*', { count: 'exact', head: true }).eq('project_id', projectId)).count).toBe(0);
  });
});
