import { describe, expect, it, jest } from '@jest/globals';
import {
  generationWatchPlan,
  plannedAssetsForSubmission,
  prepareGenerationRestore,
  type MapGenerationAsset,
} from '@/features/create-map/hooks/useMapGeneration';
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

function assetRecordsFor(plan: ReturnType<typeof makeValidMapPlan>): MapAssetRecord[] {
  return buildMapAssetPlans(plan).map((row) => assetRecordFor(row));
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

  it('restores planned assets to awaiting confirmation', async () => {
    const plan = makeValidMapPlan();
    const restored = await prepareGenerationRestore(
      { mapId: 'map-1', revisionId: 'revision-assets', plan, records: assetRecordsFor(plan) },
      jest.fn()
    );

    expect(restored.phase).toBe('awaiting-confirmation');
    expect(restored.assets.every((asset) => asset.status === 'planned')).toBe(true);
  });

  it('restores mixed ready and planned assets to awaiting confirmation', async () => {
    const plan = makeValidMapPlan();
    const records = assetRecordsFor(plan).map((record, index) =>
      index === 0 ? { ...record, status: 'ready' as const } : record
    );
    const restored = await prepareGenerationRestore(
      { mapId: 'map-1', revisionId: 'revision-assets', plan, records },
      jest.fn()
    );

    expect(restored.phase).toBe('awaiting-confirmation');
    expect(restored.assets.map((asset) => asset.status)).toContain('ready');
    expect(restored.assets.map((asset) => asset.status)).toContain('planned');
  });

  it('restores terminal and planned assets to awaiting confirmation when no work is active', async () => {
    const plan = makeValidMapPlan();
    const records = assetRecordsFor(plan).map((record, index) =>
      index === 0 ? { ...record, status: 'ready' as const }
        : index === 1 ? { ...record, status: 'failed' as const }
          : record
    );
    const restored = await prepareGenerationRestore(
      { mapId: 'map-1', revisionId: 'revision-assets', plan, records },
      jest.fn()
    );

    expect(restored.phase).toBe('awaiting-confirmation');
  });

  it('restores queued-only assets as active generation work', async () => {
    const plan = makeValidMapPlan();
    const records = assetRecordsFor(plan).map((record) => ({ ...record, status: 'queued' as const }));
    const restored = await prepareGenerationRestore(
      { mapId: 'map-1', revisionId: 'revision-assets', plan, records },
      jest.fn()
    );

    expect(restored.phase).toBe('generating');
    expect(restored.assets.every((asset) => asset.status === 'queued')).toBe(true);
  });

  it('restores queued and planned assets as active generation work', async () => {
    const plan = makeValidMapPlan();
    const records = assetRecordsFor(plan).map((record, index) =>
      index === 0 ? { ...record, status: 'queued' as const } : record
    );
    const restored = await prepareGenerationRestore(
      { mapId: 'map-1', revisionId: 'revision-assets', plan, records },
      jest.fn()
    );

    expect(restored.phase).toBe('generating');
    expect(restored.assets.map((asset) => asset.status)).toContain('queued');
    expect(restored.assets.map((asset) => asset.status)).toContain('planned');
  });

  it('watches queued assets but selects only generating assets for direct polling', () => {
    const rows = buildMapAssetPlans(makeValidMapPlan());
    const statuses: MapGenerationAsset['status'][] = ['queued', 'generating', 'ready', 'failed'];
    const assets = rows.map((row, index): MapGenerationAsset => ({
      ...row,
      id: `asset-${index}`,
      status: statuses[index],
      attemptCount: 0,
      errorCode: null,
      storagePath: null,
      signedUrl: null,
    }));

    expect(generationWatchPlan(assets)).toMatchObject({
      active: true,
      pollAssetIds: ['asset-1'],
    });
  });

  it('keeps scheduling identity stable for clones and changes it for watched status or ID changes', () => {
    const rows = buildMapAssetPlans(makeValidMapPlan());
    const statuses: MapGenerationAsset['status'][] = ['queued', 'generating', 'ready', 'failed'];
    const assets = rows.map((row, index): MapGenerationAsset => ({
      ...row,
      id: `asset-${index}`,
      status: statuses[index],
      attemptCount: 0,
      errorCode: null,
      storagePath: null,
      signedUrl: null,
    }));
    const clones = assets.map((asset) => ({ ...asset }));
    const statusChanged = clones.map((asset) =>
      asset.id === 'asset-0' ? { ...asset, status: 'generating' as const } : asset
    );
    const idChanged = clones.map((asset) =>
      asset.id === 'asset-1' ? { ...asset, id: 'asset-next' } : asset
    );

    expect(generationWatchPlan(clones).key).toBe(generationWatchPlan(assets).key);
    expect(generationWatchPlan(statusChanged).key).not.toBe(generationWatchPlan(assets).key);
    expect(generationWatchPlan(idChanged).key).not.toBe(generationWatchPlan(assets).key);
  });

  it('selects only planned assets with IDs for a resumed submission', () => {
    const rows = buildMapAssetPlans(makeValidMapPlan());
    const statuses: MapGenerationAsset['status'][] = ['ready', 'planned', 'failed', 'planned'];
    const assets = rows.map((row, index): MapGenerationAsset => ({
      ...row,
      id: index === 3 ? null : `asset-${index}`,
      status: statuses[index],
      attemptCount: 0,
      errorCode: null,
      storagePath: null,
      signedUrl: null,
    }));

    expect(plannedAssetsForSubmission(assets).map((asset) => asset.id)).toEqual(['asset-1']);
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

  it('opens an edited current Plan with one mismatched metadata field as unplanned', async () => {
    const plan = makeValidMapPlan();
    const row = buildMapAssetPlans(plan).find((candidate) => candidate.kind === 'road');
    if (!row) throw new Error('Expected a road asset plan row');
    const records = assetRecordsFor(plan).map((record) =>
      record.asset_key === row.assetKey
        ? { ...record, metadata: { ...record.metadata, width: 999 } }
        : record
    );
    const restored = await prepareGenerationRestore(
      { mapId: 'map-1', revisionId: 'revision-assets', plan, records },
      jest.fn()
    );

    expect(restored.target).toBeNull();
    expect(restored.phase).toBe('idle');
    expect(restored.assets.every((asset) => asset.status === 'unplanned')).toBe(true);
  });

  it('rejects a persisted batch when any record belongs to another Revision', async () => {
    const plan = makeValidMapPlan();
    const records = assetRecordsFor(plan).map((record, index) =>
      index === 0 ? { ...record, map_revision_id: 'revision-other' } : record
    );

    const restored = await prepareGenerationRestore(
      { mapId: 'map-1', revisionId: 'revision-assets', plan, records },
      jest.fn()
    );

    expect(restored.target).toBeNull();
    expect(restored.phase).toBe('idle');
    expect(restored.assets.every((asset) => asset.status === 'unplanned')).toBe(true);
  });
});
