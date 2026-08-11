import { describe, expect, it, jest } from '@jest/globals';
import { createMapService, type MapAssetRecord } from '@/features/create-map/services/createMapService';
import { makeEmptyMapSceneV3, makeValidMapPlanV3 } from './fixtures';

const SOURCE_REVISION_ID = '10000000-0000-4000-8000-000000000031';

function readyAsset(overrides: Partial<MapAssetRecord> = {}): MapAssetRecord {
  return {
    id: '10000000-0000-4000-8000-000000000032',
    map_revision_id: SOURCE_REVISION_ID,
    asset_key: 'map-image',
    kind: 'map_image',
    status: 'ready',
    requested_capability: 'direct_map_image',
    prompt: 'Exact map prompt.',
    generation_params: { width: 512, height: 512, noBackground: false },
    metadata: {},
    storage_path: `project-1/map-v3/${SOURCE_REVISION_ID}/map-image/${'a'.repeat(64)}.png`,
    sha256: 'a'.repeat(64),
    width: 512,
    height: 512,
    has_transparency: false,
    last_error_code: null,
    attempt_count: 1,
    generation_id: '10000000-0000-4000-8000-000000000033',
    plan_fingerprint: 'b'.repeat(64),
    provider_operation: 'create_image_pro',
    provider_job_id: 'job-1',
    ...overrides,
  };
}

function loadMock(input: {
  bound: boolean;
  plan?: ReturnType<typeof makeValidMapPlanV3>;
  generationPlan?: ReturnType<typeof makeValidMapPlanV3>;
  assets?: MapAssetRecord[];
  generationRevisionId?: string | null;
  generationAssets?: MapAssetRecord[];
  signingFails?: boolean;
}) {
  const plan = input.plan ?? makeValidMapPlanV3();
  const emptyScene = makeEmptyMapSceneV3({ map: plan.map });
  const scene = input.bound ? {
    ...emptyScene,
    mapImage: {
      assetKey: 'map-image' as const,
      sourceRevisionId: SOURCE_REVISION_ID,
      width: 512,
      height: 512,
      locked: true as const,
    },
  } : emptyScene;
  const from = jest.fn((table: string) => {
    if (table === 'map_projects') {
      return { select: () => ({ eq: () => ({ single: async () => ({
        data: { project_id: 'project-1', current_revision_id: '10000000-0000-4000-8000-000000000030' },
        error: null,
      }) }) }) };
    }
    if (table === 'map_revisions') {
      const filters: Record<string, string> = {};
      const builder = {
        eq: (column: string, value: string) => {
          filters[column] = value;
          return builder;
        },
        single: async () => ({
          data: filters.id === input.generationRevisionId ? {
            schema_version: 3,
            plan: input.generationPlan ?? plan,
          } : {
          id: '10000000-0000-4000-8000-000000000030',
          revision_number: 4,
          save_version: 2,
          parent_revision_id: input.generationRevisionId ?? null,
          source_document_id: null,
          schema_version: 3,
          plan,
          scene,
          },
          error: null,
        }),
      };
      return { select: () => builder };
    }
    if (table === 'map_assets') {
      const filters: Record<string, string> = {};
      const builder = {
        eq: (column: string, value: string) => {
          filters[column] = value;
          return builder;
        },
        limit: async () => ({
          data: filters.map_revision_id === input.generationRevisionId
            ? input.generationAssets ?? []
            : input.assets ?? [readyAsset()],
          error: null,
        }),
      };
      return { select: () => builder };
    }
    throw new Error(`Unexpected table: ${table}`);
  });
  const createSignedUrl = jest.fn(async () => input.signingFails
    ? { data: null, error: { message: 'temporary signing failure' } }
    : { data: { signedUrl: 'https://signed.example/map.png' }, error: null });
  const service = createMapService({
    from,
    storage: { from: () => ({ createSignedUrl }) },
  } as never);
  return { service, from, createSignedUrl, plan, scene };
}

describe('direct map restore', () => {
  it('restores an empty V3 draft without looking up or signing an asset', async () => {
    const { service, from, createSignedUrl, plan, scene } = loadMock({ bound: false });

    await expect(service.loadSavedMapV3('map-v3')).resolves.toEqual({
      identity: {
        mapId: 'map-v3',
        revisionId: '10000000-0000-4000-8000-000000000030',
        revisionNumber: 4,
        saveVersion: 2,
      },
      plan,
      scene,
      projectId: 'project-1',
      sourceDocumentId: null,
      generationPlan: null,
      assetRevisionId: null,
      imageAsset: null,
      imageUrl: null,
      boundImageAsset: null,
      boundImageUrl: null,
    });
    expect(from).not.toHaveBeenCalledWith('map_assets');
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it('loads and signs only the exact ready opaque map image bound by the Scene', async () => {
    const asset = readyAsset();
    const { service, createSignedUrl, plan } = loadMock({ bound: true, assets: [asset] });

    await expect(service.loadSavedMapV3('map-v3')).resolves.toMatchObject({
      plan: { schemaVersion: 3 },
      scene: { schemaVersion: 3 },
      assetRevisionId: SOURCE_REVISION_ID,
      generationPlan: plan,
      imageAsset: asset,
      imageUrl: 'https://signed.example/map.png',
      boundImageAsset: asset,
      boundImageUrl: 'https://signed.example/map.png',
    });
    expect(createSignedUrl).toHaveBeenCalledWith(asset.storage_path, 300);
  });

  it.each(['planned', 'generating', 'failed', 'blocked'] as const)(
    'restores an unbound %s generation from the current draft parent revision',
    async (status) => {
      const generationRevisionId = '10000000-0000-4000-8000-000000000040';
      const generation = readyAsset({
        id: '10000000-0000-4000-8000-000000000041',
        map_revision_id: generationRevisionId,
        status,
        storage_path: null,
        sha256: null,
        width: null,
        height: null,
        has_transparency: null,
        provider_operation: status === 'generating' ? 'create_image_pro' : null,
        provider_job_id: status === 'generating' ? 'job-active' : null,
      });
      const { service } = loadMock({
        bound: false,
        generationRevisionId,
        generationAssets: [generation],
      });

      await expect(service.loadSavedMapV3('map-v3')).resolves.toMatchObject({
        assetRevisionId: generationRevisionId,
        imageAsset: generation,
        imageUrl: null,
        boundImageAsset: null,
        boundImageUrl: null,
      });
    },
  );

  it('loads an active regeneration separately while preserving the bound ready image', async () => {
    const generationRevisionId = '10000000-0000-4000-8000-000000000040';
    const bound = readyAsset();
    const active = readyAsset({
      id: '10000000-0000-4000-8000-000000000041',
      map_revision_id: generationRevisionId,
      status: 'failed',
      storage_path: null,
      sha256: null,
      width: null,
      height: null,
      has_transparency: null,
      provider_operation: 'create_image_pro',
      provider_job_id: 'job-active',
    });
    const { service, createSignedUrl } = loadMock({
      bound: true,
      assets: [bound],
      generationRevisionId,
      generationAssets: [active],
    });

    await expect(service.loadSavedMapV3('map-v3')).resolves.toMatchObject({
      assetRevisionId: generationRevisionId,
      imageAsset: active,
      imageUrl: null,
      boundImageAsset: bound,
      boundImageUrl: 'https://signed.example/map.png',
    });
    expect(createSignedUrl).toHaveBeenCalledTimes(1);
    expect(createSignedUrl).toHaveBeenCalledWith(bound.storage_path, 300);
  });

  it('validates a ready parent generation against its immutable dimensions after the draft profile changes', async () => {
    const generationRevisionId = '10000000-0000-4000-8000-000000000040';
    const generationPlan = makeValidMapPlanV3();
    const currentPlan = makeValidMapPlanV3({ map: { width: 688, height: 384 } });
    const active = readyAsset({
      id: '10000000-0000-4000-8000-000000000041',
      map_revision_id: generationRevisionId,
      storage_path: `project-1/map-v3/${generationRevisionId}/map-image/${'a'.repeat(64)}.png`,
    });
    const { service } = loadMock({
      bound: false,
      plan: currentPlan,
      generationPlan,
      generationRevisionId,
      generationAssets: [active],
    });

    await expect(service.loadSavedMapV3('map-v3')).resolves.toMatchObject({
      plan: currentPlan,
      generationPlan,
      imageAsset: active,
    });
  });

  it('preserves the durable ready asset when temporary URL signing fails', async () => {
    const asset = readyAsset();
    const { service } = loadMock({ bound: true, assets: [asset], signingFails: true });

    await expect(service.loadSavedMapV3('map-v3')).resolves.toMatchObject({
      imageAsset: asset,
      imageUrl: null,
    });
  });

  it.each([
    ['missing asset', []],
    ['multiple assets', [readyAsset(), readyAsset({ id: '10000000-0000-4000-8000-000000000034' })]],
    ['non-ready asset', [readyAsset({ status: 'failed' })]],
    ['wrong revision', [readyAsset({ map_revision_id: '10000000-0000-4000-8000-000000000099' })]],
    ['wrong dimensions', [readyAsset({ width: 688 })]],
    ['transparent image', [readyAsset({ has_transparency: true })]],
    ['hashless image', [readyAsset({ sha256: null })]],
    ['wrong provider operation', [readyAsset({ provider_operation: 'create_map_object' })]],
    ['missing generation identity', [readyAsset({ generation_id: null })]],
    ['missing plan fingerprint', [readyAsset({ plan_fingerprint: null })]],
    ['wrong private storage path', [readyAsset({ storage_path: `other/map/path/${'a'.repeat(64)}.png` })]],
  ])('rejects a bound Scene with %s', async (_name, assets) => {
    const { service, createSignedUrl } = loadMock({ bound: true, assets: assets as MapAssetRecord[] });

    await expect(service.loadSavedMapV3('map-v3')).rejects.toMatchObject({ code: 'invalid_saved_map' });
    expect(createSignedUrl).not.toHaveBeenCalled();
  });
});
