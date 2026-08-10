import { describe, expect, it, jest } from '@jest/globals';
import {
  fitObstacleToRegion,
  materializeRegionObstacleEntity,
  regionObstacleRequestMatches,
} from '@/features/create-map/hooks/useRegionObstacleGeneration';
import type { GenerationTarget } from '@/features/create-map/hooks/useMapGeneration';
import { clampMapRegionSelection } from '@/features/create-map/model/mapRegionSelection';
import { validateMapSceneV2, type MapSceneV2 } from '@/features/create-map/model/mapSceneSchema';
import type { MapAssetRecord } from '@/features/create-map/services/createMapService';
import { makeValidMapPlanV2, makeValidMapSceneV2 } from './fixtures';

jest.mock('@/lib/SupabaseContext', () => ({ useSupabase: () => ({}) }));

function readyRecord(metadata: Record<string, unknown>): MapAssetRecord {
  return {
    id: '30000000-0000-4000-8000-000000000003',
    map_revision_id: '10000000-0000-4000-8000-000000000001',
    generation_id: '20000000-0000-4000-8000-000000000002',
    plan_fingerprint: 'a'.repeat(64),
    asset_key: 'region-obstacle-1',
    kind: 'obstacle',
    status: 'ready',
    requested_capability: 'map_object',
    prompt: 'Mossy shrine',
    generation_params: {},
    metadata,
    storage_path: 'private/region-obstacle-1.png',
    sha256: 'b'.repeat(64),
    width: 32,
    height: 64,
    has_transparency: true,
    last_error_code: null,
    attempt_count: 1,
  };
}

describe('regional obstacle generation geometry', () => {
  it('clamps reverse drag selections to map coordinates', () => {
    expect(clampMapRegionSelection(
      { x: 120, y: 90, width: -150, height: -110 },
      { width: 128, height: 96 },
    )).toEqual({ x: 0, y: 0, width: 120, height: 90 });
  });

  it('aspect-fits the image and aligns its ground anchor to the selection bottom center', () => {
    expect(fitObstacleToRegion(
      { x: 10, y: 20, width: 64, height: 48 },
      { width: 32, height: 64 },
    )).toEqual({
      scale: 0.75,
      position: { x: 42, y: 68 },
      groundAnchor: { x: 16, y: 64 },
    });
  });

  it('materializes one editable entity with alpha-derived local collision', () => {
    const scene = makeValidMapSceneV2();
    const entity = materializeRegionObstacleEntity(
      { x: 10, y: 20, width: 64, height: 48 },
      readyRecord({
        alphaBounds: { x: 4, y: 20, width: 24, height: 24 },
        opaquePixelCount: 450,
        visiblePixelCount: 500,
        opaqueFillRatio: 0.78,
      }),
      scene,
    );

    expect(entity).toEqual(expect.objectContaining({
      id: 'region-entity-30000000-0000-4000-8000-000000000003',
      assetKey: 'region-obstacle-1',
      source: 'region-generation',
      position: { x: 42, y: 68 },
      scale: 0.75,
      zIndex: 11,
      collision: { shape: 'circle', cx: 0, cy: -32, radius: 12 },
    }));

    const withRegionEntity: MapSceneV2 = { ...scene, obstacleEntities: [...scene.obstacleEntities, entity] };
    expect(validateMapSceneV2(makeValidMapPlanV2(), withRegionEntity).success).toBe(true);
  });

  it('keeps Plan-sourced unknown assets invalid while allowing durable regional assets', () => {
    const plan = makeValidMapPlanV2();
    const scene = makeValidMapSceneV2();
    const unknown = { ...scene.obstacleEntities[0], assetKey: 'external-obstacle' };
    expect(validateMapSceneV2(plan, { ...scene, obstacleEntities: [{ ...unknown, source: 'plan' }] }).success).toBe(false);
    expect(validateMapSceneV2(plan, { ...scene, obstacleEntities: [{ ...unknown, source: 'region-generation' }] }).success).toBe(true);
  });

  it('discards a regional obstacle when either the installed target or request epoch is stale', () => {
    const expected: GenerationTarget = {
      projectId: 'project-1',
      mapId: 'map-1',
      revisionId: 'revision-1',
      generationId: 'generation-1',
      planFingerprint: 'a'.repeat(64),
    };

    expect(regionObstacleRequestMatches({ ...expected }, expected, 4, 4)).toBe(true);
    expect(regionObstacleRequestMatches({ ...expected, mapId: 'map-2' }, expected, 4, 4)).toBe(false);
    expect(regionObstacleRequestMatches({ ...expected }, expected, 5, 4)).toBe(false);
  });
});
