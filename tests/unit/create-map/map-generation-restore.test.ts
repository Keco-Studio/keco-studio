import { describe, expect, it, jest } from '@jest/globals';
import {
  generationPhaseFor,
  generationRetryOperation,
  generationTargetMatches,
  generationWatchPlan,
  imageLoadMatches,
  mapPlanFingerprint,
  materializeMapSceneV2,
  prepareGenerationRestore,
  type GenerationTarget,
  type MapGenerationAsset,
} from '@/features/create-map/hooks/useMapGeneration';
import { buildMapAssetPlansV2, type MapAssetPlanRowV2 } from '@/features/create-map/model/mapAssetPlan';
import type { MapSceneV2 } from '@/features/create-map/model/mapSceneSchema';
import type { MapAssetRecord } from '@/features/create-map/services/createMapService';
import { makeEmptyMapSceneV2, makeValidMapPlanV2, makeValidMapSceneV2 } from './fixtures';

jest.mock('@/lib/SupabaseContext', () => ({ useSupabase: () => ({}) }));

const REVISION = '10000000-0000-4000-8000-000000000001';
const GENERATION = '20000000-0000-4000-8000-000000000002';

async function target(): Promise<GenerationTarget> {
  return {
    projectId: 'project-1',
    mapId: 'map-1',
    revisionId: REVISION,
    generationId: GENERATION,
    planFingerprint: await mapPlanFingerprint(makeValidMapPlanV2()),
  };
}

function recordFor(
  row: MapAssetPlanRowV2,
  planFingerprint: string,
  index: number,
  overrides: Partial<MapAssetRecord> = {},
): MapAssetRecord {
  return {
    id: `asset-${index}`,
    map_revision_id: REVISION,
    generation_id: GENERATION,
    plan_fingerprint: planFingerprint,
    asset_key: row.assetKey,
    kind: row.kind,
    status: 'planned',
    requested_capability: row.requestedCapability,
    prompt: row.prompt,
    generation_params: row.generationParams,
    metadata: row.metadata,
    storage_path: null,
    sha256: null,
    width: null,
    height: null,
    has_transparency: null,
    last_error_code: null,
    attempt_count: 0,
    ...overrides,
  };
}

async function recordsForPlan(overrides: (row: MapAssetPlanRowV2, index: number) => Partial<MapAssetRecord> = () => ({})) {
  const plan = makeValidMapPlanV2();
  const fingerprint = await mapPlanFingerprint(plan);
  return buildMapAssetPlansV2(plan).map((row, index) =>
    recordFor(row, fingerprint, index, overrides(row, index))
  );
}

function materializedScene(): MapSceneV2 {
  const scene = makeValidMapSceneV2();
  return {
    ...scene,
    background: scene.background ? { ...scene.background, assetKey: 'background' } : null,
  };
}

function asset(row: MapAssetPlanRowV2, status: MapGenerationAsset['status']): MapGenerationAsset {
  return {
    ...row,
    id: `asset-${row.assetKey}`,
    status,
    attemptCount: status === 'planned' ? 0 : 1,
    errorCode: null,
    storagePath: null,
    sha256: status === 'ready' ? 'a'.repeat(64) : null,
    signedUrl: null,
  };
}

describe('Create Map V2 generation restore and state', () => {
  it('restores persisted planned resources to explicit confirmation without resubmission', async () => {
    const plan = makeValidMapPlanV2();
    const sign = jest.fn();
    const restored = await prepareGenerationRestore({
      projectId: 'project-1', mapId: 'map-1', revisionId: REVISION,
      plan, scene: makeEmptyMapSceneV2(), records: await recordsForPlan(),
    }, sign);

    expect(restored.target).toEqual(await target());
    expect(restored.phase).toBe('awaiting-confirmation');
    expect(restored.assets.every((entry) => entry.status === 'planned')).toBe(true);
    expect(sign).not.toHaveBeenCalled();
  });

  it('restores ready source atlases with an unplanned background into composition phase', async () => {
    const plan = makeValidMapPlanV2();
    const records = (await recordsForPlan((row) => row.kind === 'background' ? {} : {
      status: 'ready', storage_path: `private/${row.assetKey}.png`, sha256: 'a'.repeat(64), attempt_count: 1,
    })).filter((record) => record.kind !== 'background');
    const restored = await prepareGenerationRestore({
      projectId: 'project-1', mapId: 'map-1', revisionId: REVISION,
      plan, scene: makeEmptyMapSceneV2(), records,
    }, async (path) => `signed://${path}`);

    expect(restored.phase).toBe('composing-background');
    expect(restored.assets.find((entry) => entry.kind === 'background')).toMatchObject({ id: null, status: 'unplanned' });
  });

  it('keeps one signed URL failure local while retaining durable ready state', async () => {
    const plan = makeValidMapPlanV2();
    const records = await recordsForPlan((_row, index) => ({
      status: 'ready', storage_path: `private/${index}.png`, sha256: 'b'.repeat(64), attempt_count: 1,
    }));
    const backgroundPath = records.find((record) => record.kind === 'background')?.storage_path;
    const restored = await prepareGenerationRestore({
      projectId: 'project-1', mapId: 'map-1', revisionId: REVISION,
      plan, scene: materializedScene(), records,
    }, async (path) => {
      if (path === backgroundPath) throw new Error('sign failed');
      return `signed://${path}`;
    });

    expect(restored.phase).toBe('ready');
    expect(restored.assets.find((entry) => entry.kind === 'background'))
      .toMatchObject({ status: 'ready', signedUrl: null });
    expect(restored.assets.find((entry) => entry.assetKey === 'mossy-rock')?.signedUrl).toContain('signed://');
    expect(restored.assets.filter((entry) => entry.kind === 'terrain' || entry.kind === 'path')
      .every((entry) => entry.signedUrl === null)).toBe(true);
  });

  it('rejects mixed revision, generation, or fingerprint records as an idle preview', async () => {
    const plan = makeValidMapPlanV2();
    const records = await recordsForPlan((_row, index) => index === 0 ? { generation_id: 'other-generation' } : {});
    const restored = await prepareGenerationRestore({
      projectId: 'project-1', mapId: 'map-1', revisionId: REVISION,
      plan, scene: makeEmptyMapSceneV2(), records,
    }, jest.fn());

    expect(restored.target).toBeNull();
    expect(restored.phase).toBe('idle');
    expect(restored.assets.every((entry) => entry.status === 'unplanned')).toBe(true);
  });

  it('classifies partial atlas failure and excludes internal background work from provider polling', () => {
    const rows = buildMapAssetPlansV2(makeValidMapPlanV2());
    const assets = rows.map((row) => asset(row,
      row.kind === 'terrain' && row.assetKey === 'meadow-grass' ? 'ready'
        : row.kind === 'path' ? 'blocked'
          : row.kind === 'background' ? 'generating'
            : 'queued'
    ));

    expect(generationPhaseFor(assets)).toBe('partial');
    const watch = generationWatchPlan(assets);
    expect(watch.active).toBe(true);
    expect(watch.pollAssetIds).not.toContain(`asset-${rows.find((row) => row.kind === 'background')?.assetKey}`);
  });

  it('uses compose-only retry for backgrounds and full target matching for stale guards', async () => {
    const rows = buildMapAssetPlansV2(makeValidMapPlanV2());
    expect(generationRetryOperation(asset(rows.find((row) => row.kind === 'background') as MapAssetPlanRowV2, 'failed')))
      .toBe('compose_background');
    expect(generationRetryOperation(asset(rows[0], 'failed'))).toBe('retry');

    const current = await target();
    expect(generationTargetMatches(current, { ...current })).toBe(true);
    expect(generationTargetMatches(current, { ...current, generationId: 'stale-generation' })).toBe(false);
    expect(generationTargetMatches(null, current)).toBe(false);
  });

  it('restores a ready regional obstacle referenced by Scene and signs only render assets', async () => {
    const plan = makeValidMapPlanV2();
    const fingerprint = await mapPlanFingerprint(plan);
    const records = await recordsForPlan((row) => ({
      status: 'ready',
      storage_path: `private/${row.assetKey}.png`,
      sha256: 'c'.repeat(64),
      attempt_count: 1,
    }));
    records.push({
      ...recordFor(buildMapAssetPlansV2(plan).find((row) => row.kind === 'obstacle') as MapAssetPlanRowV2, fingerprint, 99),
      id: 'regional-asset-1',
      asset_key: 'region-obstacle-1',
      prompt: 'Mossy shrine',
      generation_params: { source: 'region-generation' },
      metadata: { source: 'region-generation' },
      status: 'ready',
      storage_path: 'private/region-obstacle-1.png',
      sha256: 'd'.repeat(64),
      width: 64,
      height: 96,
      attempt_count: 1,
    });
    const baseScene = materializedScene();
    const scene: MapSceneV2 = {
      ...baseScene,
      obstacleEntities: [...baseScene.obstacleEntities, {
        ...baseScene.obstacleEntities[0],
        id: 'region-entity-1',
        assetKey: 'region-obstacle-1',
        source: 'region-generation',
      }],
    };
    const sign = jest.fn(async (path: string) => `signed://${path}`);

    const restored = await prepareGenerationRestore({
      projectId: 'project-1', mapId: 'map-1', revisionId: REVISION, plan, scene, records,
    }, sign);

    expect(restored.sceneAssets).toEqual([
      expect.objectContaining({ assetKey: 'region-obstacle-1', status: 'ready', signedUrl: 'signed://private/region-obstacle-1.png' }),
    ]);
    expect(sign.mock.calls.map(([path]) => path).sort()).toEqual([
      'private/background.png',
      'private/mossy-rock.png',
      'private/region-obstacle-1.png',
    ]);
  });

  it('rejects materialized workspaces whose exact Scene asset binding is missing', async () => {
    const plan = makeValidMapPlanV2();
    const records = (await recordsForPlan((row) => ({
      status: 'ready', storage_path: `private/${row.assetKey}.png`, sha256: 'e'.repeat(64), attempt_count: 1,
    }))).filter((record) => record.asset_key !== 'mossy-rock');

    await expect(prepareGenerationRestore({
      projectId: 'project-1', mapId: 'map-1', revisionId: REVISION,
      plan, scene: materializedScene(), records,
    }, jest.fn())).rejects.toThrow('Saved map Scene asset is not ready: mossy-rock');
  });

  it('rejects stale image loads by installed epoch and exact asset binding', () => {
    expect(imageLoadMatches(3, 3, 'asset-a:hash-a', 'asset-a:hash-a')).toBe(true);
    expect(imageLoadMatches(4, 3, 'asset-a:hash-a', 'asset-a:hash-a')).toBe(false);
    expect(imageLoadMatches(3, 3, 'asset-b:hash-b', 'asset-a:hash-a')).toBe(false);
  });

  it('materializes only ready planned obstacles and preserves existing entity transforms on background regeneration', async () => {
    const plan = makeValidMapPlanV2();
    const currentTarget = await target();
    const records = await recordsForPlan((row) => row.kind === 'background' || row.kind === 'obstacle'
      ? { status: 'ready', storage_path: `private/${row.assetKey}.png`, sha256: 'c'.repeat(64), attempt_count: 1 }
      : { status: 'ready', attempt_count: 1 });
    const first = materializeMapSceneV2(plan, makeEmptyMapSceneV2(), currentTarget, records);
    expect(first?.background).toMatchObject({ locked: true, sourceRevisionId: REVISION, assetKey: 'background' });
    expect(first?.obstacleEntities).toHaveLength(1);

    const edited = {
      ...makeValidMapSceneV2(),
      obstacleEntities: makeValidMapSceneV2().obstacleEntities.map((entity) => ({
        ...entity, position: { x: 111, y: 99 }, scale: 1.5,
      })),
    };
    const regenerated = materializeMapSceneV2(plan, edited, currentTarget, records);
    expect(regenerated?.obstacleEntities[0]).toMatchObject({ position: { x: 111, y: 99 }, scale: 1.5 });
  });
});
