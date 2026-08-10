import { describe, expect, it, jest } from '@jest/globals';
import {
  generationPhaseFor,
  generationRetryOperation,
  generationTargetMatches,
  generationWatchPlan,
  mapPlanFingerprint,
  materializeMapSceneV2,
  prepareGenerationRestore,
  type GenerationTarget,
  type MapGenerationAsset,
} from '@/features/create-map/hooks/useMapGeneration';
import { buildMapAssetPlansV2, type MapAssetPlanRowV2 } from '@/features/create-map/model/mapAssetPlan';
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
      plan, records: await recordsForPlan(),
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
      projectId: 'project-1', mapId: 'map-1', revisionId: REVISION, plan, records,
    }, async (path) => `signed://${path}`);

    expect(restored.phase).toBe('composing-background');
    expect(restored.assets.find((entry) => entry.kind === 'background')).toMatchObject({ id: null, status: 'unplanned' });
  });

  it('keeps one signed URL failure local while retaining durable ready state', async () => {
    const plan = makeValidMapPlanV2();
    const records = await recordsForPlan((_row, index) => ({
      status: 'ready', storage_path: `private/${index}.png`, sha256: 'b'.repeat(64), attempt_count: 1,
    }));
    const restored = await prepareGenerationRestore({
      projectId: 'project-1', mapId: 'map-1', revisionId: REVISION, plan, records,
    }, async (path) => {
      if (path === 'private/0.png') throw new Error('sign failed');
      return `signed://${path}`;
    });

    expect(restored.phase).toBe('ready');
    expect(restored.assets[0]).toMatchObject({ status: 'ready', signedUrl: null });
    expect(restored.assets.slice(1).every((entry) => entry.signedUrl)).toBe(true);
  });

  it('rejects mixed revision, generation, or fingerprint records as an idle preview', async () => {
    const plan = makeValidMapPlanV2();
    const records = await recordsForPlan((_row, index) => index === 0 ? { generation_id: 'other-generation' } : {});
    const restored = await prepareGenerationRestore({
      projectId: 'project-1', mapId: 'map-1', revisionId: REVISION, plan, records,
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
