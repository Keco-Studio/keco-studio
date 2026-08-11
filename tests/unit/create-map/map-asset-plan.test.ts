import { describe, expect, it } from '@jest/globals';
import { buildMapAssetPlans, buildMapAssetPlansV2 } from '@/features/create-map/model/mapAssetPlan';
import type { MapPlan } from '@/features/create-map/model/mapPlanSchema';
import { makeValidMapPlanV2 } from './fixtures';

const plan: MapPlan = {
  schemaVersion: 1,
  name: 'Meadow',
  visualBrief: 'A small clearing.',
  map: { width: 640, height: 448, tileSize: 32, projection: 'top-down', palette: ['#7f9c68'], stylePrompt: 'Crisp pixel art.' },
  terrains: [{ assetKey: 'grass', name: 'Grass', prompt: 'Green grass', weight: 1, transitionKeys: [] }],
  roads: [{ assetKey: 'road', name: 'Road', prompt: 'Dirt road', terrainKey: 'grass', width: 32, points: [{ x: 0, y: 224 }, { x: 640, y: 224 }] }],
  objects: [{ assetKey: 'tree', name: 'Tree', prompt: 'Oak tree', size: { width: 64, height: 80 }, groundAnchor: { x: 32, y: 72 }, movable: true }],
  objectInstances: [{ id: 'tree-1', assetKey: 'tree', position: { x: 96, y: 96 }, scale: 1, rotation: 0, zIndex: 1 }],
  obstacles: [],
};

describe('buildMapAssetPlans', () => {
  it('maps terrain, road, and object resources to the discovered PixelLab operations', () => {
    const rows = buildMapAssetPlans(plan);
    expect(rows.map((row) => [row.assetKey, row.kind, row.requestedCapability])).toEqual([
      ['grass', 'terrain', 'create_topdown_tileset'],
      ['road', 'road', 'create_path_tiles'],
      ['tree', 'object', 'create_map_object'],
    ]);
    expect(rows[0].generationParams).not.toHaveProperty('description');
    expect(rows[1].generationParams).toMatchObject({ tile_type: 'square_topdown', tile_size: 32 });
    expect(rows[2].generationParams).toMatchObject({ width: 64, height: 80, view: 'high top-down' });
  });
});

describe('buildMapAssetPlansV2', () => {
  it('keeps provider operation names out of browser V2 plans and derives required masks', () => {
    const v2Plan = makeValidMapPlanV2();
    const rows = buildMapAssetPlansV2(v2Plan);

    expect(rows.map((row) => [row.assetKey, row.kind, row.requestedCapability])).toEqual([
      ['meadow-grass', 'terrain', 'topdown_tileset'],
      ['packed-earth', 'terrain', 'topdown_tileset'],
      ['market-road-tiles', 'path', 'path_tiles'],
      ['mossy-rock', 'obstacle', 'map_object'],
      ['background', 'background', null],
    ]);
    expect(rows.flatMap((row) => Object.values(row.generationParams)))
      .not.toEqual(expect.arrayContaining(['create_topdown_tileset', 'create_path_tiles', 'create_map_object']));
    expect(rows.find((row) => row.assetKey === 'market-road-tiles')?.generationParams)
      .toMatchObject({ requiredConnectivityMasks: [1, 2, 5, 12] });
    const terrain = rows.find((row) => row.assetKey === 'meadow-grass');
    expect(terrain?.generationParams).toMatchObject({
      requiredConnectivityMasks: [15],
      transitionSize: 0,
      outline: 'lineless',
      tileStrength: 0.5,
    });
    expect(terrain?.prompt).toContain('seamless natural top-down pixel-art ground surface');
    expect(terrain?.prompt).toContain(v2Plan.background.stylePrompt);
    expect(terrain?.prompt).toContain(v2Plan.background.palette.join(', '));
    expect(terrain?.prompt).toContain('avoid neon or fluorescent saturation');
    expect(terrain?.prompt).toContain('without visible seams, periodic patterns, or large flat color fields');
    expect(terrain?.prompt).toContain('no roads, no paths, no bridges');
    const path = rows.find((row) => row.assetKey === 'market-road-tiles');
    expect(path?.prompt).toContain('Top-down pixel-art ground:');
    expect(path?.prompt).toContain('Flat ground-level path');
    expect(path?.prompt).toContain('no curbs, no walls, no rails, no raised borders');
    expect(path?.prompt).not.toContain(v2Plan.background.stylePrompt);
  });

  it('records provider-supported dimensions while preserving the requested obstacle size', () => {
    const plan = makeValidMapPlanV2();
    plan.obstacleAssets[0].size = { width: 24, height: 28 };
    const obstacle = buildMapAssetPlansV2(plan).find((row) => row.kind === 'obstacle');

    expect(obstacle?.generationParams).toMatchObject({ width: 32, height: 32 });
    expect(obstacle?.metadata).toMatchObject({ targetWidth: 24, targetHeight: 28 });
  });

  it('requests only the complete deck tile for bridge paths', () => {
    const plan = makeValidMapPlanV2();
    plan.background.paths[0].name = 'Wooden bridge';
    plan.background.paths[0].prompt = 'Wooden bridge deck over water.';
    const bridge = buildMapAssetPlansV2(plan).find((row) => row.assetKey === 'market-road-tiles');

    expect(bridge?.generationParams).toMatchObject({ requiredConnectivityMasks: [15] });
  });

  it('constrains obstacle generation to one static environmental prop', () => {
    const plan = makeValidMapPlanV2();
    plan.background.stylePrompt = 'Quiet meadow tiles with paths and market scenery';
    plan.obstacleAssets[0].prompt = 'A moss-covered standing stone';
    const obstacle = buildMapAssetPlansV2(plan).find((row) => row.kind === 'obstacle');

    expect(obstacle?.prompt).toContain('Single static environmental map prop');
    expect(obstacle?.prompt).toContain('Subject: A moss-covered standing stone');
    expect(obstacle?.prompt).toContain('No people, no characters, no NPCs');
    expect(obstacle?.prompt).toContain('no animals, no creatures');
  });
});
