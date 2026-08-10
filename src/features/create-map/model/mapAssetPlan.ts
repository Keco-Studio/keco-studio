import type { MapPlan, MapObjectPlan, RoadPlan, TerrainPlan } from './mapPlanSchema';

export type MapAssetKind = 'terrain' | 'road' | 'object';

export type MapAssetPlanRow = {
  assetKey: string;
  kind: MapAssetKind;
  prompt: string;
  requestedCapability: 'create_topdown_tileset' | 'create_path_tiles' | 'create_map_object';
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
