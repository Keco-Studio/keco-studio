import { describe, expect, it } from '@jest/globals';
import {
  MapPlanSchema,
  MapPlanV2Schema,
  validateMapPlan,
  validateMapPlanV2,
} from '@/features/create-map/model/mapPlanSchema';
import { makeValidMapPlan, makeValidMapPlanV2 } from './fixtures';

describe('MapPlanSchema', () => {
  it('accepts a complete provider-independent plan', () => {
    const plan = makeValidMapPlan();
    const parsed = MapPlanSchema.parse(plan);

    expect(parsed.terrains).toHaveLength(2);
    expect(parsed.roads[0].terrainKey).toBe('packed-earth');
    expect(parsed.objects[0].movable).toBe(true);
    expect(new Set(parsed.obstacles.map((obstacle) => obstacle.shape))).toEqual(
      new Set(['rectangle', 'circle', 'polygon'])
    );
    expect(validateMapPlan(plan)).toEqual({ success: true, data: plan });
  });

  it('rejects duplicate keys, missing terrain references, invalid polygons, and off-map objects', () => {
    const plan = makeValidMapPlan();
    plan.objects.push({ ...plan.objects[0], assetKey: plan.objects[0].assetKey });
    plan.roads[0].terrainKey = 'missing';
    plan.obstacles[0] = {
      id: 'bad',
      shape: 'polygon',
      points: [
        { x: 1, y: 1 },
        { x: 2, y: 2 },
      ],
    };
    plan.objectInstances[0].position.x = plan.map.width + 1;

    const result = validateMapPlan(plan);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.map((issue) => issue.code)).toEqual(
        expect.arrayContaining(['duplicate_asset_key', 'missing_terrain', 'invalid_polygon', 'outside_map'])
      );
      expect(result.issues.every((issue) => issue.path.length > 0)).toBe(true);
    }
  });

  it('returns stable semantic issues for invalid dimensions and references', () => {
    const plan = makeValidMapPlan();
    plan.map.width = 0;
    plan.objectInstances[0].assetKey = 'missing-object';

    const result = validateMapPlan(plan);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'invalid_dimension', path: ['map', 'width'] }),
          expect.objectContaining({ code: 'missing_object', path: ['objectInstances', 0, 'assetKey'] }),
        ])
      );
    }
  });

  it('rejects zero-area polygons and road points outside the map', () => {
    const plan = makeValidMapPlan();
    plan.obstacles[2] = {
      id: 'flat-polygon',
      shape: 'polygon',
      points: [
        { x: 10, y: 10 },
        { x: 20, y: 20 },
        { x: 30, y: 30 },
      ],
    };
    plan.roads[0].points[1] = { x: -1, y: 120 };

    const result = validateMapPlan(plan);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'invalid_polygon', path: ['obstacles', 2, 'points'] }),
          expect.objectContaining({ code: 'outside_map', path: ['roads', 0, 'points', 1] }),
        ])
      );
    }
  });

  it('rejects credential-shaped resource fields and non-kebab asset keys', () => {
    const plan = makeValidMapPlan() as unknown as Record<string, unknown>;
    const terrains = plan.terrains as Array<Record<string, unknown>>;
    terrains[0].apiKey = 'not-allowed';
    terrains[1].assetKey = 'Packed Earth';

    const parsed = MapPlanSchema.safeParse(plan);

    expect(parsed.success).toBe(false);
  });
});

describe('MapPlanV2Schema', () => {
  it('accepts a layered plan with editable path prompts and local obstacle collision', () => {
    const plan = makeValidMapPlanV2();

    expect(MapPlanV2Schema.parse(plan).background.paths[0]).toEqual(
      expect.objectContaining({ name: 'Market road', prompt: expect.any(String), kind: 'road' })
    );
    expect(validateMapPlanV2(plan)).toEqual({ success: true, data: plan });
  });

  it('rejects indivisible dimensions, bad references, duplicate keys, and self-intersecting regions', () => {
    const plan = makeValidMapPlanV2();
    plan.map.width = 127;
    plan.background.baseTerrainKey = 'missing-terrain';
    plan.obstacleAssets[0].assetKey = plan.background.paths[0].assetKey;
    plan.background.regions[0].points = [
      { x: 0, y: 0 },
      { x: 96, y: 96 },
      { x: 96, y: 0 },
      { x: 0, y: 96 },
    ];

    const result = validateMapPlanV2(plan);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
        'invalid_dimension',
        'missing_terrain',
        'duplicate_asset_key',
        'invalid_polygon',
      ]));
    }
  });

  it('rejects partial path contracts and placements outside the map', () => {
    const plan = makeValidMapPlanV2();
    delete (plan.background.paths[0] as Partial<typeof plan.background.paths[0]>).prompt;
    plan.obstaclePlacements[0].position.x = 129;

    expect(MapPlanV2Schema.safeParse(plan).success).toBe(false);

    const offMap = makeValidMapPlanV2();
    offMap.obstaclePlacements[0].position.x = 129;
    const result = validateMapPlanV2(offMap);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues).toContainEqual(expect.objectContaining({
        code: 'outside_map',
        path: ['obstaclePlacements', 0, 'position'],
      }));
    }
  });
});
