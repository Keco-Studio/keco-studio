import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  makeEmptyMapSceneV2,
  makeValidMapPlan,
  makeValidMapPlanV2,
  makeValidMapScene,
} from './fixtures';
import {
  CreateMapServiceError,
  createMapService,
  createSceneFromPlan,
  type MapAssetRecord,
} from '@/features/create-map/services/createMapService';

const originalFetch = global.fetch;

describe('Create Map browser service', () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => { global.fetch = originalFetch; });

  it('requests a project-scoped plan without placing document text in the browser request', async () => {
    const plan = makeValidMapPlan();
    const sourceToken = {
      documentId: '11111111-1111-4111-8111-111111111111',
      documentUpdatedAt: '2026-08-08T08:00:00.000Z', epoch: 1, revision: 2,
    };
    global.fetch = jest.fn(async () => Response.json({ plan, sourceToken })) as typeof fetch;
    const service = createMapService({} as never);

    await expect(service.createPlan('project-1', sourceToken.documentId)).resolves.toEqual({ plan, sourceToken });
    const init = (global.fetch as jest.MockedFunction<typeof fetch>).mock.calls[0][1];
    expect(init?.body).toBe(JSON.stringify({ projectId: 'project-1', documentId: sourceToken.documentId }));
    expect(init?.body).not.toContain('Village design markdown');
  });

  it('requests and validates a description-only V2 Plan without Project fields', async () => {
    const plan = makeValidMapPlanV2();
    global.fetch = jest.fn(async () => Response.json({ plan, sourceToken: null })) as typeof fetch;
    const service = createMapService({} as never);

    await expect(service.createPlanV2('A riverside market')).resolves.toEqual({ plan, sourceToken: null });
    const init = (global.fetch as jest.MockedFunction<typeof fetch>).mock.calls[0][1];
    expect(init?.body).toBe(JSON.stringify({ description: 'A riverside market' }));
  });

  it('rejects a malformed V2 planner source token', async () => {
    global.fetch = jest.fn(async () => Response.json({
      plan: makeValidMapPlanV2(),
      sourceToken: { documentId: 'document-1' },
    })) as typeof fetch;

    await expect(createMapService({} as never).createPlanV2(
      'Use the village document',
      'project-1',
      'document-1'
    )).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('maps compare-and-swap conflicts to a stable service error', async () => {
    const rpc = jest.fn(async () => ({ data: [{ status: 'conflict', save_version: null }], error: null }));
    const service = createMapService({ rpc } as never);
    const identity = { mapId: 'map-1', revisionId: 'revision-1', revisionNumber: 1, saveVersion: 4 };

    await expect(service.saveDraft(identity, makeValidMapPlan(), makeValidMapScene()))
      .rejects.toMatchObject(new CreateMapServiceError('save_conflict'));
    expect(rpc).toHaveBeenCalledWith('save_map_draft', expect.objectContaining({ p_expected_save_version: 4 }));
  });

  it('creates a description-only V2 project with a completely null source tuple', async () => {
    const rpc = jest.fn(async () => ({
      data: [{ map_id: 'map-v2', draft_revision_id: 'revision-v2', revision_number: 1, save_version: 0 }],
      error: null,
    }));
    const plan = makeValidMapPlanV2();
    const scene = makeEmptyMapSceneV2();

    await expect(createMapService({ rpc } as never).createProjectV2('project-1', plan, scene, null))
      .resolves.toEqual({ mapId: 'map-v2', revisionId: 'revision-v2', revisionNumber: 1, saveVersion: 0 });
    expect(rpc).toHaveBeenCalledWith('create_map_project_v2', expect.objectContaining({
      p_name: plan.name,
      p_source_document_id: null,
      p_source_document_updated_at: null,
      p_source_epoch: null,
      p_source_revision: null,
      p_plan: plan,
      p_scene: scene,
    }));
  });

  it('maps V2 compare-and-swap conflicts to the same stable service error', async () => {
    const rpc = jest.fn(async () => ({ data: [{ status: 'conflict', save_version: null }], error: null }));
    const identity = { mapId: 'map-v2', revisionId: 'revision-v2', revisionNumber: 1, saveVersion: 3 };

    await expect(createMapService({ rpc } as never).saveDraftV2(
      identity,
      makeValidMapPlanV2(),
      makeEmptyMapSceneV2()
    )).rejects.toMatchObject(new CreateMapServiceError('save_conflict'));
    expect(rpc).toHaveBeenCalledWith('save_map_draft_v2', expect.objectContaining({ p_expected_save_version: 3 }));
  });

  it('creates editable scene objects and Keco obstacle geometry from a plan', () => {
    const plan = makeValidMapPlan();
    const scene = createSceneFromPlan(plan);
    expect(scene.size).toEqual({ width: 512, height: 384, tileSize: 32 });
    expect(scene.objects[0]).toMatchObject({ assetKey: 'oak-tree', movable: true, groundAnchor: { x: 32, y: 72 } });
    expect(scene.obstacles).toEqual(plan.obstacles);
    expect(scene.tiles.length).toBeGreaterThan(0);
    expect(scene.tiles.some((tile) => tile.terrainKey === 'market-road')).toBe(true);
  });

  it('forks stale edits against the server current revision', async () => {
    const single = jest.fn(async () => ({ data: { current_revision_id: 'revision-current' }, error: null }));
    const from = jest.fn(() => ({ select: () => ({ eq: () => ({ single }) }) }));
    const rpc = jest.fn(async () => ({
      data: [{ status: 'forked', draft_revision_id: 'revision-new', revision_number: 3, save_version: 0 }],
      error: null,
    }));
    const service = createMapService({ from, rpc } as never);
    const identity = { mapId: 'map-1', revisionId: 'revision-stale', revisionNumber: 1, saveVersion: 4 };

    await expect(service.forkDraft(identity, makeValidMapPlan(), makeValidMapScene())).resolves.toMatchObject({
      revisionId: 'revision-new', revisionNumber: 3, saveVersion: 0,
    });
    expect(rpc).toHaveBeenCalledWith('fork_map_draft', expect.objectContaining({
      p_parent_revision_id: 'revision-stale',
      p_expected_current_revision_id: 'revision-current',
    }));
  });

  it('lists the 50 most recently updated accessible maps with Project labels', async () => {
    const limit = jest.fn(async () => ({
      data: [{
        id: 'map-1', project_id: 'project-1', name: 'River Town',
        current_revision_id: 'revision-2', updated_at: '2026-08-10T01:00:00.000Z',
        projects: { name: 'Adventure' },
      }],
      error: null,
    }));
    const order = jest.fn(() => ({ limit }));
    const select = jest.fn(() => ({ order }));
    const from = jest.fn(() => ({ select }));

    await expect(createMapService({ from } as never).listSavedMaps()).resolves.toEqual([{
      id: 'map-1', projectId: 'project-1', projectName: 'Adventure', name: 'River Town',
      currentRevisionId: 'revision-2', updatedAt: '2026-08-10T01:00:00.000Z',
    }]);
    expect(order).toHaveBeenCalledWith('updated_at', { ascending: false });
    expect(limit).toHaveBeenCalledWith(50);
  });

  it('lists only maps whose current revision is schema V2', async () => {
    const limit = jest.fn(async () => ({ data: [], error: null }));
    const order = jest.fn(() => ({ limit }));
    const eq = jest.fn(() => ({ order }));
    const select = jest.fn(() => ({ eq }));
    const from = jest.fn(() => ({ select }));

    await expect(createMapService({ from } as never).listSavedMapsV2()).resolves.toEqual([]);

    expect(select.mock.calls[0][0]).toContain('!inner(schema_version)');
    expect(eq).toHaveBeenCalledWith('current_revision.schema_version', 2);
    expect(order).toHaveBeenCalledWith('updated_at', { ascending: false });
    expect(limit).toHaveBeenCalledWith(50);
  });

  it('creates V2 asset plans with explicit generation and fingerprint identity', async () => {
    const rpc = jest.fn(async () => ({ data: [{ asset_id: 'asset-v2', status: 'planned' }], error: null }));
    const fingerprint = 'a'.repeat(64);

    await expect(createMapService({ rpc } as never).createAssetPlanV2({
      revisionId: 'revision-v2',
      generationId: '10000000-0000-4000-8000-000000000002',
      assetKey: 'market-road',
      kind: 'path',
      prompt: 'Generate a complete road atlas.',
      requestedCapability: 'path_tiles',
      generationParams: { tileSize: 32 },
      referenceAssetIds: [],
      referenceHashes: [],
      planFingerprint: fingerprint,
      metadata: { pathKind: 'road' },
    })).resolves.toEqual({ asset_id: 'asset-v2', status: 'planned' });

    expect(rpc).toHaveBeenCalledWith('create_map_asset_plan_v2', expect.objectContaining({
      p_kind: 'path',
      p_plan_fingerprint: fingerprint,
      p_generation_id: '10000000-0000-4000-8000-000000000002',
    }));
  });

  it('loads the current editable Revision and assets from the newest asset-owning Revision', async () => {
    const plan = makeValidMapPlan();
    const scene = makeValidMapScene();
    const asset = makeMapAssetRecord({ id: 'asset-1', map_revision_id: 'revision-assets' });
    const from = createSavedMapLoadMock({
      map: { project_id: 'project-1', current_revision_id: 'revision-current' },
      current: {
        id: 'revision-current', revision_number: 4, save_version: 2,
        source_document_id: '11111111-1111-4111-8111-111111111111', plan, scene,
      },
      assetOwner: { id: 'revision-assets', revision_number: 3, map_assets: [{ id: asset.id }] },
      assets: [asset],
    });

    const loaded = await createMapService({ from } as never).loadSavedMap('map-1');
    expect(loaded.identity).toEqual({
      mapId: 'map-1', revisionId: 'revision-current', revisionNumber: 4, saveVersion: 2,
    });
    expect(loaded.plan).toEqual(plan);
    expect(loaded.scene).toEqual(scene);
    expect(loaded.assetRevisionId).toBe('revision-assets');
    expect(loaded.assets).toEqual([asset]);
  });

  it('parses V2 Plan and Scene responses and preserves a null source Document', async () => {
    const plan = makeValidMapPlanV2();
    const scene = makeEmptyMapSceneV2();
    const from = createV2SavedMapLoadMock({ plan, scene });

    await expect(createMapService({ from } as never).loadSavedMapV2('map-v2')).resolves.toEqual({
      identity: { mapId: 'map-v2', revisionId: 'revision-v2', revisionNumber: 1, saveVersion: 0 },
      plan,
      scene,
      projectId: 'project-1',
      sourceDocumentId: null,
      assetRevisionId: null,
      assets: [],
    });
  });

  it('rejects V1 payloads returned through the V2 saved-map contract', async () => {
    const from = createV2SavedMapLoadMock({ plan: makeValidMapPlan(), scene: makeValidMapScene() });

    await expect(createMapService({ from } as never).loadSavedMapV2('map-v2'))
      .rejects.toMatchObject({ code: 'invalid_saved_map' });
  });

  it('rejects malformed persisted Plan or Scene before returning a workspace', async () => {
    const from = createSavedMapLoadMock({
      map: { project_id: 'project-1', current_revision_id: 'revision-current' },
      current: {
        id: 'revision-current', revision_number: 1, save_version: 0,
        source_document_id: '11111111-1111-4111-8111-111111111111',
        plan: { schemaVersion: 1 }, scene: makeValidMapScene(),
      },
      assetOwner: null,
      assets: [],
    });

    await expect(createMapService({ from } as never).loadSavedMap('map-1'))
      .rejects.toMatchObject({ code: 'invalid_saved_map' });
  });

  it.each([
    ['Plan', { schemaVersion: 1 }, makeValidMapScene()],
    ['Scene', makeValidMapPlan(), { schemaVersion: 1 }],
  ])('rejects a malformed persisted current draft %s before returning it', async (_kind, plan, scene) => {
    const from = createCurrentDraftLoadMock(plan, scene);

    await expect(createMapService({ from } as never).loadCurrentDraft('map-1'))
      .rejects.toMatchObject({ code: 'invalid_saved_map' });
  });
});

function createCurrentDraftLoadMock(plan: unknown, scene: unknown) {
  return jest.fn((table: string) => {
    if (table === 'map_projects') {
      return { select: () => ({ eq: () => ({ single: async () => ({
        data: { current_revision_id: 'revision-current' }, error: null,
      }) }) }) };
    }
    if (table === 'map_revisions') {
      return { select: () => ({ eq: () => ({ single: async () => ({
        data: { plan, scene, save_version: 0, revision_number: 1 }, error: null,
      }) }) }) };
    }
    throw new Error(`Unexpected table: ${table}`);
  });
}

function createV2SavedMapLoadMock(input: { plan: unknown; scene: unknown }) {
  return jest.fn((table: string) => {
    if (table === 'map_projects') {
      return { select: () => ({ eq: () => ({ single: async () => ({
        data: { project_id: 'project-1', current_revision_id: 'revision-v2' }, error: null,
      }) }) }) };
    }
    if (table === 'map_revisions') {
      return { select: () => ({ eq: () => ({ eq: () => ({ single: async () => ({
        data: {
          id: 'revision-v2', revision_number: 1, save_version: 0,
          source_document_id: null, schema_version: 2, plan: input.plan, scene: input.scene,
        },
        error: null,
      }) }) }) }) };
    }
    throw new Error(`Unexpected table: ${table}`);
  });
}

function makeMapAssetRecord(overrides: Partial<MapAssetRecord> = {}): MapAssetRecord {
  return {
    id: 'asset-1', map_revision_id: 'revision-assets', asset_key: 'meadow-grass', kind: 'terrain',
    status: 'ready', requested_capability: 'create_topdown_tileset', prompt: 'Saved terrain',
    generation_params: {}, metadata: {}, storage_path: null, sha256: null, width: 128, height: 128,
    has_transparency: false, last_error_code: null, attempt_count: 1, ...overrides,
  };
}

function createSavedMapLoadMock(input: {
  map: Record<string, unknown>;
  current: Record<string, unknown>;
  assetOwner: Record<string, unknown> | null;
  assets: MapAssetRecord[];
}) {
  let revisionQuery = 0;
  return jest.fn((table: string) => {
    if (table === 'map_projects') {
      return { select: () => ({ eq: () => ({ single: async () => ({ data: input.map, error: null }) }) }) };
    }
    if (table === 'map_revisions' && revisionQuery++ === 0) {
      return { select: () => ({ eq: () => ({ single: async () => ({ data: input.current, error: null }) }) }) };
    }
    if (table === 'map_revisions') {
      return { select: () => ({ eq: () => ({ order: () => ({ limit: () => ({
        maybeSingle: async () => ({ data: input.assetOwner, error: null }),
      }) }) }) }) };
    }
    if (table === 'map_assets') {
      return { select: () => ({ eq: () => ({ order: async () => ({ data: input.assets, error: null }) }) }) };
    }
    throw new Error(`Unexpected table: ${table}`);
  });
}
