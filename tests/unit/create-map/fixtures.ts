import type { MapPlan, MapPlanV2 } from '@/features/create-map/model/mapPlanSchema';
import type { MapScene, MapSceneV2 } from '@/features/create-map/model/mapSceneSchema';

export function makeValidMapPlan(): MapPlan {
  return {
    schemaVersion: 1,
    name: 'Riverside Market',
    visualBrief: 'A compact top-down market map with a curved path and movable props.',
    map: {
      width: 512,
      height: 384,
      tileSize: 32,
      projection: 'top-down',
      palette: ['#5f8a55', '#b59664', '#707b82'],
      stylePrompt: 'Readable pixel art with soft natural colors and crisp silhouettes.',
    },
    terrains: [
      {
        assetKey: 'meadow-grass',
        name: 'Meadow grass',
        prompt: 'Seamless meadow grass Wang tileset with sparse flowers.',
        weight: 0.8,
        transitionKeys: ['packed-earth'],
      },
      {
        assetKey: 'packed-earth',
        name: 'Packed earth',
        prompt: 'Seamless packed earth Wang tileset for paths and market clearings.',
        weight: 0.2,
        transitionKeys: ['meadow-grass'],
      },
    ],
    roads: [
      {
        assetKey: 'market-road',
        name: 'Market road',
        prompt: 'Packed earth road compatible with the meadow terrain transitions.',
        terrainKey: 'packed-earth',
        width: 32,
        points: [
          { x: 32, y: 192 },
          { x: 256, y: 176 },
          { x: 480, y: 208 },
        ],
      },
    ],
    objects: [
      {
        assetKey: 'oak-tree',
        name: 'Oak tree',
        prompt: 'A broad oak tree as a transparent top-down pixel art object.',
        size: { width: 64, height: 80 },
        groundAnchor: { x: 32, y: 72 },
        movable: true,
      },
    ],
    objectInstances: [
      {
        id: 'tree-1',
        assetKey: 'oak-tree',
        position: { x: 96, y: 80 },
        scale: 1,
        rotation: 0,
        zIndex: 10,
      },
    ],
    obstacles: [
      { id: 'stall-block', shape: 'rectangle', x: 160, y: 96, width: 64, height: 48 },
      { id: 'fountain-block', shape: 'circle', cx: 320, cy: 192, radius: 24 },
      {
        id: 'garden-block',
        shape: 'polygon',
        points: [
          { x: 360, y: 64 },
          { x: 416, y: 80 },
          { x: 400, y: 128 },
        ],
      },
    ],
  };
}

export function makeValidMapScene(): MapScene {
  const plan = makeValidMapPlan();
  return {
    schemaVersion: 1,
    size: { width: plan.map.width, height: plan.map.height, tileSize: plan.map.tileSize },
    layers: [
      { id: 'terrain', name: 'Terrain', kind: 'terrain', visible: true, locked: false },
      { id: 'objects', name: 'Objects', kind: 'objects', visible: true, locked: false },
      { id: 'overlay', name: 'Overlay', kind: 'overlay', visible: true, locked: false },
    ],
    tiles: [
      { id: 'tile-0-0', layerId: 'terrain', terrainKey: 'meadow-grass', x: 0, y: 0, wangIndex: 0 },
      { id: 'tile-1-0', layerId: 'terrain', terrainKey: 'packed-earth', x: 1, y: 0, wangIndex: 5 },
    ],
    objects: [
      {
        id: 'tree-1',
        layerId: 'objects',
        assetKey: 'oak-tree',
        position: { x: 96, y: 80 },
        scale: 1,
        rotation: 0,
        zIndex: 10,
        groundAnchor: { x: 32, y: 72 },
        movable: true,
      },
    ],
    obstacles: plan.obstacles,
    canvas: { zoom: 1, panX: 0, panY: 0, snapToGrid: true },
  };
}

export function makeValidMapPlanV2(): MapPlanV2 {
  return {
    schemaVersion: 2,
    name: 'Riverside Market V2',
    visualBrief: 'A compact layered market map with grass, a road, and movable rocks.',
    map: {
      width: 128,
      height: 96,
      tileSize: 32,
      projection: 'top-down',
    },
    background: {
      stylePrompt: 'Readable top-down pixel art with crisp silhouettes.',
      palette: ['#5f8a55', '#b59664', '#707b82'],
      baseTerrainKey: 'meadow-grass',
      regions: [
        {
          id: 'earth-clearing',
          terrainKey: 'packed-earth',
          points: [
            { x: 64, y: 0 },
            { x: 128, y: 0 },
            { x: 128, y: 96 },
            { x: 64, y: 96 },
          ],
        },
      ],
      paths: [
        {
          id: 'market-road',
          name: 'Market road',
          prompt: 'A narrow packed-earth road with complete directional connections.',
          kind: 'road',
          assetKey: 'market-road-tiles',
          terrainKey: 'packed-earth',
          width: 32,
          zIndex: 1,
          points: [
            { x: 16, y: 16 },
            { x: 48, y: 16 },
            { x: 48, y: 80 },
          ],
        },
      ],
    },
    terrains: [
      {
        assetKey: 'meadow-grass',
        name: 'Meadow grass',
        prompt: 'Seamless meadow grass terrain with sparse flowers.',
      },
      {
        assetKey: 'packed-earth',
        name: 'Packed earth',
        prompt: 'Seamless packed earth terrain for market clearings.',
      },
    ],
    obstacleAssets: [
      {
        assetKey: 'mossy-rock',
        name: 'Mossy rock',
        prompt: 'A transparent top-down mossy rock obstacle.',
        size: { width: 32, height: 32 },
        groundAnchor: { x: 16, y: 28 },
      },
    ],
    obstaclePlacements: [
      {
        id: 'rock-1',
        assetKey: 'mossy-rock',
        position: { x: 96, y: 64 },
        scale: 1,
        rotation: 0,
        zIndex: 10,
        collision: { shape: 'circle', cx: 0, cy: -8, radius: 10 },
      },
    ],
  };
}

export function makeEmptyMapSceneV2(): MapSceneV2 {
  const plan = makeValidMapPlanV2();
  return {
    schemaVersion: 2,
    size: {
      width: plan.map.width,
      height: plan.map.height,
      tileSize: plan.map.tileSize,
    },
    background: null,
    layers: [
      { id: 'background', name: 'Background', kind: 'background', visible: true, locked: true },
      { id: 'obstacles', name: 'Obstacles', kind: 'obstacles', visible: true, locked: false },
      { id: 'collision', name: 'Collision', kind: 'collision', visible: false, locked: false },
    ],
    obstacleEntities: [],
    canvas: { zoom: 1, panX: 0, panY: 0, snapToGrid: true },
  };
}

export function makeValidMapSceneV2(): MapSceneV2 {
  const plan = makeValidMapPlanV2();
  return {
    ...makeEmptyMapSceneV2(),
    background: {
      layerId: 'background',
      assetKey: 'composed-background',
      sourceRevisionId: '10000000-0000-4000-8000-000000000001',
      width: plan.map.width,
      height: plan.map.height,
      locked: true,
    },
    obstacleEntities: [
      {
        id: 'rock-1',
        layerId: 'obstacles',
        assetKey: 'mossy-rock',
        position: { x: 96, y: 64 },
        scale: 1,
        rotation: 0,
        zIndex: 10,
        groundAnchor: { x: 16, y: 28 },
        collision: { shape: 'circle', cx: 0, cy: -8, radius: 10 },
        source: 'plan',
      },
    ],
  };
}
