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

function loadMock(input: { bound: boolean; assets?: MapAssetRecord[]; signingFails?: boolean }) {
  const plan = makeValidMapPlanV3();
  const scene = input.bound ? {
    ...makeEmptyMapSceneV3(),
    mapImage: {
      assetKey: 'map-image' as const,
      sourceRevisionId: SOURCE_REVISION_ID,
      width: 512,
      height: 512,
      locked: true as const,
    },
  } : makeEmptyMapSceneV3();
  const from = jest.fn((table: string) => {
    if (table === 'map_projects') {
      return { select: () => ({ eq: () => ({ single: async () => ({
        data: { project_id: 'project-1', current_revision_id: '10000000-0000-4000-8000-000000000030' },
        error: null,
      }) }) }) };
    }
    if (table === 'map_revisions') {
      return { select: () => ({ eq: () => ({ eq: () => ({ single: async () => ({
        data: {
          id: '10000000-0000-4000-8000-000000000030',
          revision_number: 4,
          save_version: 2,
          source_document_id: null,
          schema_version: 3,
          plan,
          scene,
        },
        error: null,
      }) }) }) }) };
    }
    if (table === 'map_assets') {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({ limit: async () => ({ data: input.assets ?? [readyAsset()], error: null }) }),
            }),
          }),
        }),
      };
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
      assetRevisionId: null,
      imageAsset: null,
      imageUrl: null,
    });
    expect(from).not.toHaveBeenCalledWith('map_assets');
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it('loads and signs only the exact ready opaque map image bound by the Scene', async () => {
    const asset = readyAsset();
    const { service, createSignedUrl } = loadMock({ bound: true, assets: [asset] });

    await expect(service.loadSavedMapV3('map-v3')).resolves.toMatchObject({
      plan: { schemaVersion: 3 },
      scene: { schemaVersion: 3 },
      assetRevisionId: SOURCE_REVISION_ID,
      imageAsset: asset,
      imageUrl: 'https://signed.example/map.png',
    });
    expect(createSignedUrl).toHaveBeenCalledWith(asset.storage_path, 300);
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
