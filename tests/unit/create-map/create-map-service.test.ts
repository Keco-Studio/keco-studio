import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { makeValidMapPlan, makeValidMapScene } from './fixtures';
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

  it('maps compare-and-swap conflicts to a stable service error', async () => {
    const rpc = jest.fn(async () => ({ data: [{ status: 'conflict', save_version: null }], error: null }));
    const service = createMapService({ rpc } as never);
    const identity = { mapId: 'map-1', revisionId: 'revision-1', revisionNumber: 1, saveVersion: 4 };

    await expect(service.saveDraft(identity, makeValidMapPlan(), makeValidMapScene()))
      .rejects.toMatchObject(new CreateMapServiceError('save_conflict'));
    expect(rpc).toHaveBeenCalledWith('save_map_draft', expect.objectContaining({ p_expected_save_version: 4 }));
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
