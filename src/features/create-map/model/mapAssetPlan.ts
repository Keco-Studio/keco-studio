import { rasterizeBackgroundLayout } from './backgroundGeometry';
import type {
  MapPlan,
  MapPlanV2,
  MapObjectPlan,
  ObstacleAssetPlan,
  RoadPlan,
  TerrainAssetPlan,
  TerrainPlan,
} from './mapPlanSchema';

export type MapAssetKind = 'terrain' | 'road' | 'object';

export type MapAssetPlanRow = {
  assetKey: string;
  kind: MapAssetKind;
  prompt: string;
  requestedCapability: 'create_topdown_tileset' | 'create_path_tiles' | 'create_map_object';
  generationParams: Record<string, unknown>;
  metadata: Record<string, unknown>;
};

export type MapAssetKindV2 = 'terrain' | 'path' | 'obstacle' | 'background';
export type MapAssetCapabilityV2 = 'topdown_tileset' | 'path_tiles' | 'map_object' | null;

export type MapAssetPlanRowV2 = {
  assetKey: string;
  kind: MapAssetKindV2;
  prompt: string;
  requestedCapability: MapAssetCapabilityV2;
  generationParams: Record<string, unknown>;
  metadata: Record<string, unknown>;
};

function stylePrompt(plan: MapPlan): string {
  return `${plan.map.stylePrompt} Palette: ${plan.map.palette.join(', ')}.`;
}

function terrainRow(plan: MapPlan, terrain: TerrainPlan): MapAssetPlanRow {
  const adjacent = terrain.transitionKeys
    .map((key) => plan.terrains.find((candidate) => candidate.assetKey === key)?.prompt)
    .filter((prompt): prompt is string => Boolean(prompt));
  const tileSize = plan.map.tileSize === 64 ? 64 : plan.map.tileSize === 48 ? 32 : plan.map.tileSize;
  return {
    assetKey: terrain.assetKey,
    kind: 'terrain',
    prompt: `${terrain.prompt} ${stylePrompt(plan)}`,
    requestedCapability: 'create_topdown_tileset',
    generationParams: {
      lower_description: terrain.prompt,
      upper_description: adjacent.join(' / ') || terrain.prompt,
      transition_size: adjacent.length ? 0.5 : 0,
      transition_description: adjacent.length ? 'Crisp pixel-art terrain transition.' : null,
      tile_size: { width: tileSize, height: tileSize },
      mode: tileSize === 64 ? 'pro' : 'standard',
      view: 'high top-down',
      outline: 'selective outline',
      shading: 'medium shading',
      detail: 'medium detail',
      tile_strength: 1,
    },
    metadata: { sourceAssetKey: terrain.assetKey, mapTileSize: plan.map.tileSize, transitionKeys: terrain.transitionKeys },
  };
}

function roadRow(plan: MapPlan, road: RoadPlan): MapAssetPlanRow {
  const terrain = plan.terrains.find((candidate) => candidate.assetKey === road.terrainKey);
  return {
    assetKey: road.assetKey,
    kind: 'road',
    prompt: `${road.prompt} Ground: ${terrain?.prompt ?? road.terrainKey}. ${stylePrompt(plan)}`,
    requestedCapability: 'create_path_tiles',
    generationParams: {
      tile_type: 'square_topdown',
      tile_size: 32,
      outline_mode: 'segmentation',
      seed: null,
    },
    metadata: { sourceAssetKey: road.assetKey, mapTileSize: plan.map.tileSize, terrainKey: road.terrainKey, width: road.width, points: road.points },
  };
}

function objectRow(plan: MapPlan, object: MapObjectPlan): MapAssetPlanRow {
  const width = Math.max(32, Math.min(400, Math.round(object.size.width)));
  const height = Math.max(32, Math.min(400, Math.round(object.size.height)));
  return {
    assetKey: object.assetKey,
    kind: 'object',
    prompt: `${object.prompt} ${stylePrompt(plan)} Transparent background, clean ground contact point.`,
    requestedCapability: 'create_map_object',
    generationParams: {
      width,
      height,
      view: 'high top-down',
      outline: 'selective outline',
      shading: 'medium shading',
      detail: 'medium detail',
      background_image: null,
      inpainting: null,
    },
    metadata: { sourceAssetKey: object.assetKey, targetWidth: object.size.width, targetHeight: object.size.height, groundAnchor: object.groundAnchor, movable: object.movable },
  };
}

export function buildMapAssetPlans(plan: MapPlan): MapAssetPlanRow[] {
  return [
    ...plan.terrains.map((terrain) => terrainRow(plan, terrain)),
    ...plan.roads.map((road) => roadRow(plan, road)),
    ...plan.objects.map((object) => objectRow(plan, object)),
  ];
}

function v2StylePrompt(plan: MapPlanV2): string {
  return `${plan.background.stylePrompt} Palette: ${plan.background.palette.join(', ')}.`;
}

function requiredMasksByAsset(plan: MapPlanV2): Map<string, number[]> {
  const masks = new Map<string, Set<number>>();
  rasterizeBackgroundLayout(plan).forEach((cell) => {
    const values = masks.get(cell.assetKey) ?? new Set<number>();
    values.add(cell.connectivityMask);
    masks.set(cell.assetKey, values);
  });
  return new Map(
    [...masks].map(([assetKey, values]) => [assetKey, [...values].sort((left, right) => left - right)])
  );
}

function terrainRowV2(
  plan: MapPlanV2,
  terrain: TerrainAssetPlan,
  requiredConnectivityMasks: number[]
): MapAssetPlanRowV2 {
  return {
    assetKey: terrain.assetKey,
    kind: 'terrain',
    prompt: `${terrain.prompt} ${v2StylePrompt(plan)}`,
    requestedCapability: 'topdown_tileset',
    generationParams: {
      tileSize: plan.map.tileSize,
      requiredConnectivityMasks,
      palette: plan.background.palette,
      projection: plan.map.projection,
    },
    metadata: {
      sourceAssetKey: terrain.assetKey,
      mapTileSize: plan.map.tileSize,
      normalizedAtlasSchemaVersion: 1,
    },
  };
}

function pathRowV2(
  plan: MapPlanV2,
  path: MapPlanV2['background']['paths'][number],
  requiredConnectivityMasks: number[]
): MapAssetPlanRowV2 {
  return {
    assetKey: path.assetKey,
    kind: 'path',
    prompt: `${path.prompt} Supporting terrain: ${path.terrainKey}. ${v2StylePrompt(plan)}`,
    requestedCapability: 'path_tiles',
    generationParams: {
      tileSize: plan.map.tileSize,
      requiredConnectivityMasks,
      pathKind: path.kind,
      palette: plan.background.palette,
      projection: plan.map.projection,
    },
    metadata: {
      sourcePathId: path.id,
      sourceAssetKey: path.assetKey,
      terrainKey: path.terrainKey,
      width: path.width,
      zIndex: path.zIndex,
      normalizedAtlasSchemaVersion: 1,
    },
  };
}

function obstacleRowV2(plan: MapPlanV2, obstacle: ObstacleAssetPlan): MapAssetPlanRowV2 {
  return {
    assetKey: obstacle.assetKey,
    kind: 'obstacle',
    prompt: `${obstacle.prompt} ${v2StylePrompt(plan)} Transparent background with a clear ground contact.`,
    requestedCapability: 'map_object',
    generationParams: {
      width: Math.round(obstacle.size.width),
      height: Math.round(obstacle.size.height),
      transparency: true,
      projection: plan.map.projection,
      palette: plan.background.palette,
    },
    metadata: {
      sourceAssetKey: obstacle.assetKey,
      targetWidth: obstacle.size.width,
      targetHeight: obstacle.size.height,
      groundAnchor: obstacle.groundAnchor,
    },
  };
}

export function buildMapAssetPlansV2(plan: MapPlanV2): MapAssetPlanRowV2[] {
  const masks = requiredMasksByAsset(plan);
  return [
    ...plan.terrains.map((terrain) => terrainRowV2(plan, terrain, masks.get(terrain.assetKey) ?? [])),
    ...plan.background.paths.map((path) => pathRowV2(plan, path, masks.get(path.assetKey) ?? [])),
    ...plan.obstacleAssets.map((obstacle) => obstacleRowV2(plan, obstacle)),
    {
      assetKey: 'background',
      kind: 'background',
      prompt: `Compose the locked background for ${plan.name}.`,
      requestedCapability: null,
      generationParams: {
        width: plan.map.width,
        height: plan.map.height,
        tileSize: plan.map.tileSize,
        compositorVersion: 1,
      },
      metadata: { derived: true, locked: true },
    },
  ];
}
