import { describe, expect, it, jest } from '@jest/globals';
import {
  canRetryDirectMap,
  directMapPlanFingerprint,
  directMapPhaseFor,
  directMapTargetMatches,
  materializeDirectMapScene,
  prepareDirectMapRestore,
  type DirectMapGenerationAsset,
  type DirectMapGenerationTarget,
} from '@/features/create-map/hooks/useDirectMapGeneration';
import type { MapAssetRecord, SavedMapWorkspaceV3 } from '@/features/create-map/services/createMapService';
import { makeEmptyMapSceneV3, makeValidMapPlanV3 } from './fixtures';

jest.mock('@/lib/SupabaseContext', () => ({ useSupabase: () => ({}) }));

const IDS = {
  mapId: '10000000-0000-4000-8000-000000000010',
  revisionId: '10000000-0000-4000-8000-000000000011',
  generationId: '10000000-0000-4000-8000-000000000012',
  assetId: '10000000-0000-4000-8000-000000000013',
};

const TARGET: DirectMapGenerationTarget = {
  projectId: '10000000-0000-4000-8000-000000000009',
  mapId: IDS.mapId,
  revisionId: IDS.revisionId,
  generationId: IDS.generationId,
  planFingerprint: 'b'.repeat(64),
};

function asset(
  status: DirectMapGenerationAsset['status'],
  overrides: Partial<DirectMapGenerationAsset> = {},
): DirectMapGenerationAsset {
  return {
    id: IDS.assetId,
    status,
    lastErrorCode: null,
    providerOperation: status === 'generating' || status === 'ready' ? 'create_image_pro' : null,
    providerJobId: status === 'generating' || status === 'ready' ? 'job-1' : null,
    generationId: IDS.generationId,
    planFingerprint: TARGET.planFingerprint,
    storagePath: status === 'ready' ? 'private/map.png' : null,
    sha256: status === 'ready' ? 'a'.repeat(64) : null,
    width: status === 'ready' ? 512 : null,
    height: status === 'ready' ? 512 : null,
    hasTransparency: status === 'ready' ? false : null,
    signedUrl: null,
    ...overrides,
  };
}

function record(overrides: Partial<MapAssetRecord> = {}): MapAssetRecord {
  const ready = asset('ready');
  return {
    id: ready.id,
    map_revision_id: TARGET.revisionId,
    asset_key: 'map-image',
    kind: 'map_image',
    status: 'ready',
    requested_capability: 'direct_map_image',
    prompt: makeValidMapPlanV3().description,
    generation_params: {
      width: 512,
      height: 512,
      noBackground: false,
      seed: null,
      references: [],
      styleReference: null,
    },
    metadata: {},
    storage_path: ready.storagePath,
    sha256: ready.sha256,
    width: ready.width,
    height: ready.height,
    has_transparency: ready.hasTransparency,
    last_error_code: null,
    attempt_count: 1,
    generation_id: TARGET.generationId,
    plan_fingerprint: TARGET.planFingerprint,
    provider_operation: 'create_image_pro',
    provider_job_id: 'job-1',
    ...overrides,
  };
}

describe('direct map generation lifecycle', () => {
  it.each([
    ['planned', 'awaiting-confirmation'],
    ['queued', 'generating'],
    ['generating', 'generating'],
    ['ready', 'ready'],
    ['failed', 'failed'],
    ['blocked', 'blocked'],
  ] as const)('maps %s to %s', (status, phase) => {
    expect(directMapPhaseFor(asset(status))).toBe(phase);
  });

  it('allows retry only for failed assets and bounded retryable blocked codes', () => {
    expect(canRetryDirectMap(asset('failed'))).toBe(true);
    expect(canRetryDirectMap(asset('blocked', { lastErrorCode: 'pixellab_rate_limited' }))).toBe(true);
    expect(canRetryDirectMap(asset('blocked', { lastErrorCode: 'pixellab_quota_exceeded' }))).toBe(true);
    expect(canRetryDirectMap(asset('blocked', { lastErrorCode: 'pixellab_upstream' }))).toBe(true);
    expect(canRetryDirectMap(asset('blocked', { lastErrorCode: 'pixellab_capability_missing' }))).toBe(false);
    expect(canRetryDirectMap(asset('ready'))).toBe(false);
  });

  it('materializes only an exact ready opaque map image', () => {
    const plan = makeValidMapPlanV3();
    const next = materializeDirectMapScene(plan, makeEmptyMapSceneV3(), TARGET, asset('ready'));

    expect(next?.mapImage).toEqual({
      assetKey: 'map-image',
      sourceRevisionId: TARGET.revisionId,
      width: 512,
      height: 512,
      locked: true,
    });
    expect(materializeDirectMapScene(plan, makeEmptyMapSceneV3(), TARGET, asset('ready', {
      generationId: '10000000-0000-4000-8000-000000000099',
    }))).toBeNull();
    expect(materializeDirectMapScene(plan, makeEmptyMapSceneV3(), TARGET, asset('ready', {
      hasTransparency: true,
    }))).toBeNull();
  });

  it('rejects stale targets across map, revision, generation, and fingerprint', () => {
    expect(directMapTargetMatches(TARGET, { ...TARGET })).toBe(true);
    expect(directMapTargetMatches(TARGET, { ...TARGET, mapId: 'stale' })).toBe(false);
    expect(directMapTargetMatches(TARGET, { ...TARGET, revisionId: 'stale' })).toBe(false);
    expect(directMapTargetMatches(TARGET, { ...TARGET, generationId: 'stale' })).toBe(false);
    expect(directMapTargetMatches(TARGET, { ...TARGET, planFingerprint: 'c'.repeat(64) })).toBe(false);
  });

  it('restores a matching durable asset and keeps ready state when signing fails', async () => {
    const plan = makeValidMapPlanV3();
    const planFingerprint = await directMapPlanFingerprint(plan);
    const expectedTarget = { ...TARGET, planFingerprint };
    const scene = {
      ...makeEmptyMapSceneV3(),
      mapImage: {
        assetKey: 'map-image' as const,
        sourceRevisionId: expectedTarget.revisionId,
        width: 512,
        height: 512,
        locked: true as const,
      },
    };
    const workspace = {
      identity: { mapId: TARGET.mapId, revisionId: IDS.revisionId, revisionNumber: 2, saveVersion: 0 },
      plan,
      scene,
      projectId: TARGET.projectId,
      sourceDocumentId: null,
      assetRevisionId: expectedTarget.revisionId,
      imageAsset: record({ plan_fingerprint: planFingerprint }),
      imageUrl: null,
    } satisfies SavedMapWorkspaceV3;
    const sign = jest.fn(async () => { throw new Error('temporary signing failure'); });

    await expect(prepareDirectMapRestore(workspace, sign)).resolves.toMatchObject({
      target: expectedTarget,
      phase: 'ready',
      asset: { status: 'ready', signedUrl: null },
    });
    expect(sign).toHaveBeenCalledWith('private/map.png');
  });

  it('rejects restore when generation identity or revision does not match', async () => {
    const plan = makeValidMapPlanV3();
    const workspace = {
      identity: { mapId: TARGET.mapId, revisionId: IDS.revisionId, revisionNumber: 2, saveVersion: 0 },
      plan,
      scene: makeEmptyMapSceneV3(),
      projectId: TARGET.projectId,
      sourceDocumentId: null,
      assetRevisionId: TARGET.revisionId,
      imageAsset: record({ generation_id: '10000000-0000-4000-8000-000000000099' }),
      imageUrl: null,
    } satisfies SavedMapWorkspaceV3;

    await expect(prepareDirectMapRestore(workspace, jest.fn())).rejects.toThrow('generation identity');
  });

  it('rejects an invalid provider binding before requesting a signed URL', async () => {
    const plan = makeValidMapPlanV3();
    const planFingerprint = await directMapPlanFingerprint(plan);
    const sign = jest.fn(async () => 'signed://map');
    const workspace = {
      identity: { mapId: TARGET.mapId, revisionId: IDS.revisionId, revisionNumber: 2, saveVersion: 0 },
      plan,
      scene: makeEmptyMapSceneV3(),
      projectId: TARGET.projectId,
      sourceDocumentId: null,
      assetRevisionId: TARGET.revisionId,
      imageAsset: record({ plan_fingerprint: planFingerprint, provider_operation: 'create_map_object' }),
      imageUrl: null,
    } satisfies SavedMapWorkspaceV3;

    await expect(prepareDirectMapRestore(workspace, sign)).rejects.toThrow('provider identity');
    expect(sign).not.toHaveBeenCalled();
  });
});
