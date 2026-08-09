import { describe, expect, it, jest } from '@jest/globals';
import { prepareGenerationRestore } from '@/features/create-map/hooks/useMapGeneration';
import { buildMapAssetPlans, type MapAssetPlanRow } from '@/features/create-map/model/mapAssetPlan';
import type { MapAssetRecord } from '@/features/create-map/services/createMapService';
import { makeValidMapPlan } from './fixtures';

jest.mock('@/lib/SupabaseContext', () => ({ useSupabase: () => ({}) }));

function assetRecordFor(
  row: MapAssetPlanRow,
  overrides: Partial<MapAssetRecord> = {}
): MapAssetRecord {
  return {
    id: 'asset-1', map_revision_id: 'revision-assets', asset_key: row.assetKey, kind: row.kind,
    status: 'planned', requested_capability: row.requestedCapability, prompt: row.prompt,
    generation_params: row.generationParams, metadata: row.metadata, storage_path: null, sha256: null,
    width: null, height: null, has_transparency: null, last_error_code: null, attempt_count: 0,
    ...overrides,
  };
}

describe('prepareGenerationRestore', () => {
  it('matches persisted assets to Plan rows and refreshes ready signed URLs', async () => {
    const plan = makeValidMapPlan();
    const row = buildMapAssetPlans(plan)[0];
    const record = assetRecordFor(row, { id: 'asset-1', status: 'ready', storage_path: 'private/asset.png' });
    const records = buildMapAssetPlans(plan).map((candidate) =>
      candidate.assetKey === row.assetKey ? record : assetRecordFor(candidate)
    );
    const sign = jest.fn(async () => 'signed://asset-1');

    const restored = await prepareGenerationRestore({
      mapId: 'map-1', revisionId: 'revision-assets', plan, records,
    }, sign);

    expect(restored.target).toEqual({ mapId: 'map-1', revisionId: 'revision-assets' });
    expect(restored.assets.find((asset) => asset.assetKey === row.assetKey)).toMatchObject({
      id: 'asset-1', status: 'ready', signedUrl: 'signed://asset-1',
    });
    expect(sign).toHaveBeenCalledWith('private/asset.png');
  });

  it('restores no-asset maps to idle unplanned resources', async () => {
    const restored = await prepareGenerationRestore({
      mapId: 'map-1', revisionId: null, plan: makeValidMapPlan(), records: [],
    }, jest.fn());

    expect(restored.target).toBeNull();
    expect(restored.phase).toBe('idle');
    expect(restored.assets.every((asset) => asset.status === 'unplanned')).toBe(true);
  });

  it('keeps one unavailable signed URL local without failing the restore', async () => {
    const plan = makeValidMapPlan();
    const row = buildMapAssetPlans(plan)[0];
    const record = assetRecordFor(row, { status: 'ready', storage_path: 'private/missing.png' });
    const records = buildMapAssetPlans(plan).map((candidate) =>
      candidate.assetKey === row.assetKey ? record : assetRecordFor(candidate)
    );
    const restored = await prepareGenerationRestore(
      { mapId: 'map-1', revisionId: 'revision-assets', plan, records },
      async () => { throw new Error('sign failed'); }
    );

    expect(restored.target).toEqual({ mapId: 'map-1', revisionId: 'revision-assets' });
    expect(restored.assets.find((asset) => asset.assetKey === row.assetKey)?.signedUrl).toBeNull();
  });

  it('opens an edited current Plan with incompatible old assets as unplanned', async () => {
    const plan = makeValidMapPlan();
    const row = buildMapAssetPlans(plan)[0];
    const stale = assetRecordFor(row, { prompt: `${row.prompt} stale` });
    const restored = await prepareGenerationRestore(
      { mapId: 'map-1', revisionId: 'revision-assets', plan, records: [stale] },
      jest.fn()
    );

    expect(restored.target).toBeNull();
    expect(restored.phase).toBe('idle');
    expect(restored.assets.every((asset) => asset.status === 'unplanned')).toBe(true);
  });
});
