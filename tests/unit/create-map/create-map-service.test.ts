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

  it('saves an immutable V3 Plan snapshot and publishes the exact selected Plan version', async () => {
    const rpc = jest.fn(async (name: string) => {
      if (name === 'save_map_plan_v3') {
        return {
          data: [{
            status: 'saved', plan_version_id: 'plan-v2', plan_version_number: 2, draft_save_version: 4,
          }],
          error: null,
        };
      }
      if (name === 'publish_map_revision_v3') {
        return {
          data: [{ status: 'published', published_revision_id: 'revision-v1', next_draft_revision_id: 'draft-v2' }],
          error: null,
        };
      }
      throw new Error(`Unexpected RPC: ${name}`);
    });
    const service = createMapService({ rpc } as never);
    const identity = { mapId: 'map-1', revisionId: 'draft-v1', revisionNumber: 7, saveVersion: 4 };
    const plan = makeValidMapPlanV3();

    await expect(service.savePlanV3(identity, plan)).resolves.toMatchObject({
      id: 'plan-v2', versionNumber: 2, draftRevisionId: identity.revisionId,
      draftSaveVersion: identity.saveVersion, plan,
    });
    await expect(service.publishV3(identity, 'plan-v2')).resolves.toMatchObject({
      published_revision_id: 'revision-v1', next_draft_revision_id: 'draft-v2',
    });

    expect(rpc).toHaveBeenCalledWith('save_map_plan_v3', expect.objectContaining({
      p_map_id: identity.mapId,
      p_draft_revision_id: identity.revisionId,
      p_expected_save_version: identity.saveVersion,
    }));
    expect(rpc).toHaveBeenCalledWith('publish_map_revision_v3', expect.objectContaining({
      p_map_id: identity.mapId,
      p_draft_revision_id: identity.revisionId,
      p_expected_save_version: identity.saveVersion,
      p_plan_version_id: 'plan-v2',
    }));
  });

  it('sends the selected Plan version when preparing direct map generation', async () => {
    global.fetch = jest.fn(async () => Response.json({ status: 'planned' })) as typeof fetch;
    const service = createMapService({} as never);

    await service.prepareMapGeneration({
      projectId: '10000000-0000-4000-8000-000000000001',
      mapId: '10000000-0000-4000-8000-000000000002',
      revisionId: '10000000-0000-4000-8000-000000000003',
      saveVersion: 4,
      planVersionId: '10000000-0000-4000-8000-000000000004',
    });

    expect((global.fetch as jest.MockedFunction<typeof fetch>).mock.calls[0][1]?.body).toBe(JSON.stringify({
      action: 'prepare_map_generation',
      projectId: '10000000-0000-4000-8000-000000000001',
      mapId: '10000000-0000-4000-8000-000000000002',
      revisionId: '10000000-0000-4000-8000-000000000003',
      saveVersion: 4,
      planVersionId: '10000000-0000-4000-8000-000000000004',
    }));
  });

  it('rejects a missing selected Plan version before the browser requests generation', async () => {
    global.fetch = jest.fn() as typeof fetch;

    await expect(createMapService({} as never).prepareMapGeneration({
      projectId: '10000000-0000-4000-8000-000000000001',
      mapId: '10000000-0000-4000-8000-000000000002',
      revisionId: '10000000-0000-4000-8000-000000000003',
      saveVersion: 4,
      planVersionId: '',
    })).rejects.toMatchObject({ code: 'invalid_plan_version' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('calls the selection-aware preparation RPC with the exact Plan ID', async () => {
    const rpc = jest.fn(async () => ({
      data: [{
        published_revision_id: '10000000-0000-4000-8000-000000000001',
        next_draft_revision_id: '10000000-0000-4000-8000-000000000002',
        asset_id: '10000000-0000-4000-8000-000000000003',
        asset_status: 'planned',
      }],
      error: null,
    }));

    await createMapService({ rpc } as never).prepareGenerationV3({
      mapId: '10000000-0000-4000-8000-000000000004',
      revisionId: '10000000-0000-4000-8000-000000000005',
      saveVersion: 4,
      generationId: '10000000-0000-4000-8000-000000000006',
      planFingerprint: 'a'.repeat(64),
      planVersionId: '10000000-0000-4000-8000-000000000007',
    });

    expect(rpc).toHaveBeenCalledWith('prepare_map_generation_v3', expect.objectContaining({
      p_plan_version_id: '10000000-0000-4000-8000-000000000007',
    }));
  });

  it('loads Map V1 with its bound Plan V1 when a later Plan V2 exists', async () => {
    const planV1 = makeValidMapPlanV3({ name: 'Plan V1' });
    const planV2 = makeValidMapPlanV3({ name: 'Plan V2' });
    const scene = makeEmptyMapSceneV3();
    const image = makeMapAssetRecord({
      id: 'image-v1',
      map_revision_id: 'map-revision-v1',
      asset_key: 'map-image',
      kind: 'map_image',
      status: 'ready',
      requested_capability: 'direct_map_image',
      generation_id: '10000000-0000-4000-8000-000000000001',
      plan_fingerprint: 'a'.repeat(64),
      provider_operation: 'create_image_pro',
      provider_job_id: 'job-v1',
      storage_path: `project-1/map-1/map-revision-v1/map-image/${'b'.repeat(64)}.png`,
      sha256: 'b'.repeat(64),
      width: planV1.map.width,
      height: planV1.map.height,
      has_transparency: false,
    });
    const { from, revisionQuery } = createMapVersionLoadMock({
      revision: {
        id: 'map-revision-v1', map_project_id: 'map-1', map_version_number: 1, plan_version_id: 'plan-v1',
        plan: planV1, scene,
        map_projects: { project_id: 'project-1' },
        map_plan_versions: {
          id: 'plan-v1', map_project_id: 'map-1', plan_version_number: 1,
          draft_revision_id: 'draft-v1', draft_save_version: 2, plan: planV1,
        },
      },
      assets: [image],
    });
    const storage = { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: 'https://signed.example/map-v1' }, error: null }) }) };

    await expect(createMapService({ from, storage } as never).loadMapVersionV3('map-1', 'map-revision-v1'))
      .resolves.toMatchObject({
        mapVersion: { mapRevisionId: 'map-revision-v1', mapVersionNumber: 1, planVersionId: 'plan-v1', planVersionNumber: 1 },
        planVersion: { id: 'plan-v1', versionNumber: 1, plan: planV1 },
        mapPlan: planV1,
        mapScene: expect.objectContaining({
          mapImage: expect.objectContaining({ sourceRevisionId: 'map-revision-v1' }),
        }),
        image: expect.objectContaining({ id: 'image-v1', signedUrl: 'https://signed.example/map-v1' }),
      });

    expect(revisionQuery.eq).toHaveBeenCalledWith('id', 'map-revision-v1');
    expect(revisionQuery.eq).toHaveBeenCalledWith('map_project_id', 'map-1');
    expect(planV2.name).toBe('Plan V2');
  });

  it.each([
    ['missing generation ID', { generation_id: null }],
    ['malformed generation ID', { generation_id: 'not-a-uuid' }],
    ['missing Plan fingerprint', { plan_fingerprint: null }],
    ['malformed Plan fingerprint', { plan_fingerprint: 'not-a-sha256' }],
    ['non-string provider job ID', { provider_job_id: 42 }],
  ])('rejects a ready historical image with a %s', async (_case, overrides) => {
    const plan = makeValidMapPlanV3();
    const image = makeMapAssetRecord({
      id: 'image-v1',
      map_revision_id: 'map-revision-v1',
      asset_key: 'map-image',
      kind: 'map_image',
      status: 'ready',
      requested_capability: 'direct_map_image',
      generation_id: '10000000-0000-4000-8000-000000000001',
      plan_fingerprint: 'a'.repeat(64),
      provider_operation: 'create_image_pro',
      provider_job_id: 'job-v1',
      storage_path: `project-1/map-1/map-revision-v1/map-image/${'b'.repeat(64)}.png`,
      sha256: 'b'.repeat(64),
      width: plan.map.width,
      height: plan.map.height,
      has_transparency: false,
      ...overrides,
    } as Partial<MapAssetRecord>);
    const { from } = createMapVersionLoadMock({
      revision: {
        id: 'map-revision-v1', map_project_id: 'map-1', map_version_number: 1, plan_version_id: 'plan-v1',
        scene: makeEmptyMapSceneV3(), map_projects: { project_id: 'project-1' },
        map_plan_versions: {
          id: 'plan-v1', map_project_id: 'map-1', plan_version_number: 1,
          draft_revision_id: 'draft-v1', draft_save_version: 2, plan,
        },
      },
      assets: [image],
    });

    const storage = { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: 'https://signed.example/map-v1' }, error: null }) }) };
    await expect(createMapService({ from, storage } as never).loadMapVersionV3('map-1', 'map-revision-v1'))
      .rejects.toMatchObject({ code: 'invalid_saved_map' });
  });

  it('lists ready Map versions with their independently bound Plan version numbers', async () => {
    const order = jest.fn(async () => ({
      data: [{
        id: 'map-revision-v1', map_version_number: 1, plan_version_id: 'plan-v1',
        map_plan_versions: { id: 'plan-v1', plan_version_number: 3 },
      }],
      error: null,
    }));
    const query = { eq: jest.fn(), not: jest.fn(), order };
    query.eq.mockReturnValue(query);
    query.not.mockReturnValue(query);
    const from = jest.fn(() => ({ select: jest.fn(() => query) }));

    await expect(createMapService({ from } as never).listMapVersionsV3('map-1')).resolves.toEqual([{
      mapRevisionId: 'map-revision-v1', mapVersionNumber: 1, planVersionId: 'plan-v1', planVersionNumber: 3,
    }]);
    expect(query.eq).toHaveBeenCalledWith('map_project_id', 'map-1');
    expect(query.eq).toHaveBeenCalledWith('status', 'ready');
    expect(query.not).toHaveBeenCalledWith('map_version_number', 'is', null);
    expect(order).toHaveBeenCalledWith('map_version_number', { ascending: false });
  });

  it('rejects a Map version whose embedded Plan binding belongs to another Map', async () => {
    const plan = makeValidMapPlanV3();
    const { from } = createMapVersionLoadMock({
      revision: {
        id: 'map-revision-v1', map_project_id: 'map-1', map_version_number: 1, plan_version_id: 'plan-other',
        plan, scene: makeEmptyMapSceneV3(),
        map_plan_versions: {
          id: 'plan-other', map_project_id: 'map-other', plan_version_number: 1,
          draft_revision_id: 'draft-other', draft_save_version: 0, plan,
        },
      },
      assets: [],
    });

    await expect(createMapService({ from } as never).loadMapVersionV3('map-1', 'map-revision-v1'))
      .rejects.toMatchObject({ code: 'invalid_saved_map' });
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

  it('filters paginated maps by project before limiting with deterministic updated_at/id ordering', async () => {
    const cursorId = '10000000-0000-4000-8000-000000000001';
    const updatedAt = '2026-09-24T12:34:56.123456+00:00';
    const query = {
      select: jest.fn(), eq: jest.fn(), order: jest.fn(), or: jest.fn(),
      limit: jest.fn(async () => ({ data: [], error: null })),
      single: jest.fn(async () => ({ data: { id: cursorId, updated_at: updatedAt }, error: null })),
    };
    for (const method of [query.select, query.eq, query.order, query.or]) method.mockReturnValue(query);
    const from = jest.fn(() => query);
    await createMapService({ from } as never).listSavedMaps({ projectId: 'project-1', cursor: cursorId, limit: 500 });
    expect(query.eq).toHaveBeenCalledWith('project_id', 'project-1');
    expect(query.eq).toHaveBeenCalledWith('id', cursorId);
    expect(query.order.mock.calls).toEqual([['updated_at', { ascending: false }], ['id', { ascending: false }]]);
    expect(query.or).toHaveBeenCalledWith(`updated_at.lt.${updatedAt},and(updated_at.eq.${updatedAt},id.lt.${cursorId})`);
    expect(query.limit).toHaveBeenCalledWith(51);
    expect(query.single).toHaveBeenCalledTimes(1);
  });

  it('rejects a cursor unavailable in the selected project before listing', async () => {
    const query = {
      select: jest.fn(), eq: jest.fn(), order: jest.fn(),
      limit: jest.fn(), single: jest.fn(async () => ({ data: null, error: null })),
    };
    for (const method of [query.select, query.eq, query.order]) method.mockReturnValue(query);
    await expect(createMapService({ from: () => query } as never).listSavedMaps({ projectId: 'project-1', cursor: 'foreign-map' }))
      .rejects.toMatchObject({ code: 'map_cursor_invalid' });
    expect(query.limit).not.toHaveBeenCalled();
  });

  it('lists ready V3 map-image revisions as generation history', async () => {
    const order = jest.fn(async () => ({
      data: [
        { id: 'revision-4', revision_number: 4 },
        { id: 'revision-2', revision_number: 2 },
      ],
      error: null,
    }));
    const query = {
      eq: jest.fn(),
      order,
    };
    query.eq.mockReturnValue(query);
    const from = jest.fn(() => ({ select: jest.fn(() => query) }));

    await expect(createMapService({ from } as never).listGenerationHistoryV3('map-1')).resolves.toEqual([
      { revisionId: 'revision-4', revisionNumber: 4 },
      { revisionId: 'revision-2', revisionNumber: 2 },
    ]);
    expect(query.eq).toHaveBeenCalledWith('map_project_id', 'map-1');
    expect(query.eq).toHaveBeenCalledWith('schema_version', 3);
    expect(query.eq).toHaveBeenCalledWith('map_assets.kind', 'map_image');
    expect(query.eq).toHaveBeenCalledWith('map_assets.status', 'ready');
    expect(order).toHaveBeenCalledWith('revision_number', { ascending: false });
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

function createMapVersionLoadMock(input: { revision: Record<string, unknown>; assets: MapAssetRecord[] }) {
  const revisionQuery = { eq: jest.fn(), single: jest.fn(async () => ({ data: input.revision, error: null })) };
  revisionQuery.eq.mockReturnValue(revisionQuery);
  const assetQuery = { eq: jest.fn(), order: jest.fn(async () => ({ data: input.assets, error: null })) };
  assetQuery.eq.mockReturnValue(assetQuery);
  const from = jest.fn((table: string) => {
    if (table === 'map_revisions') return { select: jest.fn(() => revisionQuery) };
    if (table === 'map_assets') return { select: jest.fn(() => assetQuery) };
    throw new Error(`Unexpected table: ${table}`);
  });
  return { from, revisionQuery };
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
