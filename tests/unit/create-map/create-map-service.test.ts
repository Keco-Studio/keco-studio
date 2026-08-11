import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  makeEmptyMapSceneV2,
  makeEmptyMapSceneV3,
  makeValidMapPlan,
  makeValidMapPlanV2,
  makeValidMapPlanV3,
  makeValidMapScene,
} from './fixtures';
import {
  CreateMapServiceError,
  createMapService,
  createSceneFromPlan,
  type MapReferenceRecord,
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
    expect(init?.body).toBe(JSON.stringify({ schemaVersion: 2, projectId: 'project-1', documentId: sourceToken.documentId }));
    expect(init?.body).not.toContain('Village design markdown');
  });

  it('requests and validates a description-only V2 Plan without Project fields', async () => {
    const plan = makeValidMapPlanV2();
    global.fetch = jest.fn(async () => Response.json({ plan, sourceToken: null })) as typeof fetch;
    const service = createMapService({} as never);

    await expect(service.createPlanV2('A riverside market')).resolves.toEqual({ plan, sourceToken: null });
    const init = (global.fetch as jest.MockedFunction<typeof fetch>).mock.calls[0][1];
    expect(init?.body).toBe(JSON.stringify({ schemaVersion: 2, description: 'A riverside market' }));
  });

  it('requests and strictly parses V3 plans without rewriting the final description', async () => {
    const plan = makeValidMapPlanV3({ description: 'Exact final description.  Keep spacing.' });
    global.fetch = jest.fn(async () => Response.json({ plan, sourceToken: null })) as typeof fetch;

    await expect(createMapService({} as never).createPlanV3('A riverside market')).resolves.toEqual({
      plan,
      sourceToken: null,
    });

    const init = (global.fetch as jest.MockedFunction<typeof fetch>).mock.calls[0][1];
    expect(init?.body).toBe(JSON.stringify({ schemaVersion: 3, description: 'A riverside market' }));
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

  it('uploads a project reference as FormData and returns the parsed response record', async () => {
    const reference = makeMapReferenceRecord();
    global.fetch = jest.fn(async () => Response.json({ reference })) as typeof fetch;
    const file = new File(['png'], 'layout.png', { type: 'image/png' });

    await expect(createMapService({} as never).uploadReference(reference.projectId, file)).resolves.toEqual(reference);

    const [url, init] = (global.fetch as jest.MockedFunction<typeof fetch>).mock.calls[0];
    expect(url).toBe('/api/create-map/references');
    expect(init).toMatchObject({ method: 'POST' });
    expect(init?.body).toBeInstanceOf(FormData);
    expect((init?.body as FormData).get('projectId')).toBe(reference.projectId);
    expect((init?.body as FormData).get('file')).toBe(file);
  });

  it('lists only requested-project reference records and rejects malformed reference payloads', async () => {
    const reference = makeMapReferenceRecord({ previewUrl: 'https://storage.example.test/signed' });
    global.fetch = jest.fn(async () => Response.json({ references: [reference] })) as typeof fetch;

    await expect(createMapService({} as never).listReferences(reference.projectId)).resolves.toEqual([reference]);
    expect((global.fetch as jest.MockedFunction<typeof fetch>).mock.calls[0][0])
      .toBe(`/api/create-map/references?projectId=${encodeURIComponent(reference.projectId)}`);

    global.fetch = jest.fn(async () => Response.json({ reference: { ...reference, id: 'not-a-uuid' } })) as typeof fetch;
    await expect(createMapService({} as never).uploadReference(reference.projectId, validReferenceFile()))
      .rejects.toMatchObject({ code: 'invalid_response' });

    global.fetch = jest.fn(async () => Response.json({ references: [{ ...reference, sha256: 'invalid', width: 0 }] })) as typeof fetch;
    await expect(createMapService({} as never).listReferences(reference.projectId))
      .rejects.toMatchObject({ code: 'invalid_response' });

    global.fetch = jest.fn(async () => Response.json({
      reference: { ...reference, storagePath: `references/${reference.projectId}/${reference.id}/unexpected.png` },
    })) as typeof fetch;
    await expect(createMapService({} as never).uploadReference(reference.projectId, validReferenceFile()))
      .rejects.toMatchObject({ code: 'invalid_response' });
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

  it('creates a V3 Project with an exact direct map Plan and Scene', async () => {
    const rpc = jest.fn(async () => ({
      data: [{ map_id: 'map-v3', draft_revision_id: 'revision-v3', revision_number: 1, save_version: 0 }],
      error: null,
    }));
    const plan = makeValidMapPlanV3();
    const scene = makeEmptyMapSceneV3();

    await expect(createMapService({ rpc } as never).createProjectV3('project-1', plan, scene, null))
      .resolves.toEqual({ mapId: 'map-v3', revisionId: 'revision-v3', revisionNumber: 1, saveVersion: 0 });
    expect(rpc).toHaveBeenCalledWith('create_map_project_v3', expect.objectContaining({
      p_project_id: 'project-1', p_plan: plan, p_scene: scene, p_source_document_id: null,
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

  it('lists only V3 maps even when a mixed-version response reaches the browser', async () => {
    const limit = jest.fn(async () => ({
      data: [
        {
          id: 'map-1', project_id: 'project-1', name: 'River Town',
          current_revision_id: 'revision-2', updated_at: '2026-08-10T01:00:00.000Z',
          current_revision: { schema_version: 3 },
          projects: { name: 'Adventure' },
        },
        {
          id: 'map-v2', project_id: 'project-1', name: 'Legacy Town',
          current_revision_id: 'revision-v2', updated_at: '2026-08-09T01:00:00.000Z',
          current_revision: { schema_version: 2 },
          projects: { name: 'Adventure' },
        },
      ],
      error: null,
    }));
    const order = jest.fn(() => ({ limit }));
    const eq = jest.fn(() => ({ order }));
    const select = jest.fn(() => ({ eq }));
    const from = jest.fn(() => ({ select }));

    await expect(createMapService({ from } as never).listSavedMaps()).resolves.toEqual([{
      id: 'map-1', projectId: 'project-1', projectName: 'Adventure', name: 'River Town',
      currentRevisionId: 'revision-2', updatedAt: '2026-08-10T01:00:00.000Z', schemaVersion: 3,
    }]);
    expect(eq).toHaveBeenCalledWith('current_revision.schema_version', 3);
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

  it('creates the single V3 map image plan with generation identity', async () => {
    const rpc = jest.fn(async () => ({ data: [{ asset_id: 'asset-v3', status: 'planned' }], error: null }));
    const generationId = '10000000-0000-4000-8000-000000000003';
    const fingerprint = 'b'.repeat(64);

    await expect(createMapService({ rpc } as never).createAssetPlanV3('revision-v3', generationId, fingerprint))
      .resolves.toEqual({ asset_id: 'asset-v3', status: 'planned' });
    expect(rpc).toHaveBeenCalledWith('create_map_asset_plan_v3', {
      p_revision_id: 'revision-v3', p_generation_id: generationId, p_plan_fingerprint: fingerprint,
    });
  });

  it('preserves a sanitized PixelLab Edge error code and message', async () => {
    const invoke = jest.fn(async () => ({
      data: null,
      error: {
        message: 'Edge Function returned a non-2xx status code',
        context: {
          json: async () => ({
            code: 'pixellab_rate_limited',
            error: 'PixelLab is temporarily rate limited. Retry this resource.',
          }),
        },
      },
    }));

    await expect(createMapService({ functions: { invoke } } as never).invokePixelLab({
      operation: 'submit', assetId: 'asset-1',
    })).rejects.toMatchObject({
      code: 'pixellab_rate_limited',
      message: 'PixelLab is temporarily rate limited. Retry this resource.',
    });
  });

  it('does not expose unsafe PixelLab Edge error text', async () => {
    const invoke = jest.fn(async () => ({
      data: null,
      error: {
        message: 'Edge Function returned a non-2xx status code',
        context: {
          json: async () => ({
            code: 'pixellab_upstream',
            error: 'download https://provider.example/private?token=secret',
          }),
        },
      },
    }));

    await expect(createMapService({ functions: { invoke } } as never).invokePixelLab({
      operation: 'submit', assetId: 'asset-1',
    })).rejects.toMatchObject({
      code: 'pixellab_upstream',
      message: 'Edge Function returned a non-2xx status code',
    });
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

function validReferenceFile() {
  return new File(['png'], 'layout.png', { type: 'image/png' });
}

function makeMapReferenceRecord(overrides: Partial<MapReferenceRecord> = {}): MapReferenceRecord {
  const projectId = '22222222-2222-4222-8222-222222222222';
  const id = '33333333-3333-4333-8333-333333333333';
  return {
    id,
    projectId,
    name: 'layout.png',
    storagePath: `references/${projectId}/${id}/${'a'.repeat(64)}.png`,
    sha256: 'a'.repeat(64),
    width: 640,
    height: 480,
    contentType: 'image/png',
    byteSize: 1024,
    previewUrl: null,
    ...overrides,
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
