import { z } from 'zod';

const AssetKeySchema = z
  .string()
  .min(1)
  .max(96)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Asset keys must use kebab-case');

const ResourcePromptSchema = z.string().trim().min(1).max(2_000);

export const PointSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
  })
  .strict();

export type Point = z.infer<typeof PointSchema>;

export const RectangleObstacleSchema = z
  .object({
    id: z.string().min(1).max(96),
    shape: z.literal('rectangle'),
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().finite(),
    height: z.number().finite(),
  })
  .strict();

export const CircleObstacleSchema = z
  .object({
    id: z.string().min(1).max(96),
    shape: z.literal('circle'),
    cx: z.number().finite(),
    cy: z.number().finite(),
    radius: z.number().finite(),
  })
  .strict();

export const PolygonObstacleSchema = z
  .object({
    id: z.string().min(1).max(96),
    shape: z.literal('polygon'),
    points: z.array(PointSchema),
  })
  .strict();

export const ObstacleSchema = z.discriminatedUnion('shape', [
  RectangleObstacleSchema,
  CircleObstacleSchema,
  PolygonObstacleSchema,
]);

export type Obstacle = z.infer<typeof ObstacleSchema>;

export const TerrainPlanSchema = z
  .object({
    assetKey: AssetKeySchema,
    name: z.string().trim().min(1).max(120),
    prompt: ResourcePromptSchema,
    weight: z.number().finite().nonnegative(),
    transitionKeys: z.array(AssetKeySchema),
  })
  .strict();

export type TerrainPlan = z.infer<typeof TerrainPlanSchema>;

export const RoadPlanSchema = z
  .object({
    assetKey: AssetKeySchema,
    name: z.string().trim().min(1).max(120),
    prompt: ResourcePromptSchema,
    terrainKey: AssetKeySchema,
    width: z.number().finite(),
    points: z.array(PointSchema).min(2),
  })
  .strict();

export type RoadPlan = z.infer<typeof RoadPlanSchema>;

export const MapObjectPlanSchema = z
  .object({
    assetKey: AssetKeySchema,
    name: z.string().trim().min(1).max(120),
    prompt: ResourcePromptSchema,
    size: z
      .object({
        width: z.number().finite(),
        height: z.number().finite(),
      })
      .strict(),
    groundAnchor: PointSchema,
    movable: z.boolean(),
  })
  .strict();

export type MapObjectPlan = z.infer<typeof MapObjectPlanSchema>;

export const PlannedObjectInstanceSchema = z
  .object({
    id: z.string().min(1).max(96),
    assetKey: AssetKeySchema,
    position: PointSchema,
    scale: z.number().finite(),
    rotation: z.number().finite(),
    zIndex: z.number().int(),
  })
  .strict();

export type PlannedObjectInstance = z.infer<typeof PlannedObjectInstanceSchema>;

export const MapPlanSchema = z
  .object({
    schemaVersion: z.literal(1),
    name: z.string().trim().min(1).max(160),
    visualBrief: z.string().trim().min(1).max(4_000),
    map: z
      .object({
        width: z.number().int().finite(),
        height: z.number().int().finite(),
        tileSize: z.union([z.literal(16), z.literal(32), z.literal(48), z.literal(64)]),
        projection: z.literal('top-down'),
        palette: z.array(z.string().trim().min(1).max(32)).min(1).max(16),
        stylePrompt: ResourcePromptSchema,
      })
      .strict(),
    terrains: z.array(TerrainPlanSchema),
    roads: z.array(RoadPlanSchema),
    objects: z.array(MapObjectPlanSchema),
    objectInstances: z.array(PlannedObjectInstanceSchema),
    obstacles: z.array(ObstacleSchema),
  })
  .strict();

export type MapPlan = z.infer<typeof MapPlanSchema>;

export type MapPlanIssueCode =
  | 'invalid_schema'
  | 'invalid_dimension'
  | 'unsupported_tile_size'
  | 'missing_terrain'
  | 'missing_object'
  | 'duplicate_asset_key'
  | 'duplicate_id'
  | 'invalid_polygon'
  | 'outside_map';

export type MapPlanIssue = {
  code: MapPlanIssueCode;
  path: Array<string | number>;
  message: string;
};

export type MapPlanValidationResult =
  | { success: true; data: MapPlan }
  | { success: false; issues: MapPlanIssue[] };

function polygonArea(points: Point[]): number {
  return Math.abs(
    points.reduce((sum, point, index) => {
      const next = points[(index + 1) % points.length];
      return sum + point.x * next.y - next.x * point.y;
    }, 0) / 2
  );
}

function schemaIssueCode(path: Array<string | number>): MapPlanIssueCode {
  if (path[0] === 'map' && (path[1] === 'width' || path[1] === 'height')) return 'invalid_dimension';
  if (path[0] === 'map' && path[1] === 'tileSize') return 'unsupported_tile_size';
  return 'invalid_schema';
}

function isPointInsideMap(point: Point, width: number, height: number): boolean {
  return point.x >= 0 && point.y >= 0 && point.x <= width && point.y <= height;
}

export function validateMapPlan(input: unknown): MapPlanValidationResult {
  const parsed = MapPlanSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      issues: parsed.error.issues.map((issue) => ({
        code: schemaIssueCode(issue.path),
        path: issue.path,
        message: issue.message,
      })),
    };
  }

  const plan = parsed.data;
  const issues: MapPlanIssue[] = [];
  const addIssue = (code: MapPlanIssueCode, path: Array<string | number>, message: string) => {
    issues.push({ code, path, message });
  };

  if (plan.map.width <= 0) addIssue('invalid_dimension', ['map', 'width'], 'Map width must be positive');
  if (plan.map.height <= 0) addIssue('invalid_dimension', ['map', 'height'], 'Map height must be positive');
  if (plan.terrains.length === 0) addIssue('missing_terrain', ['terrains'], 'At least one terrain is required');

  const assetPaths = [
    ...plan.terrains.map((resource, index) => ({ key: resource.assetKey, path: ['terrains', index, 'assetKey'] })),
    ...plan.roads.map((resource, index) => ({ key: resource.assetKey, path: ['roads', index, 'assetKey'] })),
    ...plan.objects.map((resource, index) => ({ key: resource.assetKey, path: ['objects', index, 'assetKey'] })),
  ] as Array<{ key: string; path: Array<string | number> }>;
  const seenAssetKeys = new Set<string>();
  assetPaths.forEach(({ key, path }) => {
    if (seenAssetKeys.has(key)) addIssue('duplicate_asset_key', path, `Duplicate asset key: ${key}`);
    seenAssetKeys.add(key);
  });

  const terrainKeys = new Set(plan.terrains.map((terrain) => terrain.assetKey));
  plan.terrains.forEach((terrain, terrainIndex) => {
    terrain.transitionKeys.forEach((key, keyIndex) => {
      if (!terrainKeys.has(key)) {
        addIssue('missing_terrain', ['terrains', terrainIndex, 'transitionKeys', keyIndex], `Unknown terrain: ${key}`);
      }
    });
  });
  plan.roads.forEach((road, roadIndex) => {
    if (!terrainKeys.has(road.terrainKey)) {
      addIssue('missing_terrain', ['roads', roadIndex, 'terrainKey'], `Unknown terrain: ${road.terrainKey}`);
    }
    if (road.width <= 0) addIssue('invalid_dimension', ['roads', roadIndex, 'width'], 'Road width must be positive');
    road.points.forEach((point, pointIndex) => {
      if (!isPointInsideMap(point, plan.map.width, plan.map.height)) {
        addIssue('outside_map', ['roads', roadIndex, 'points', pointIndex], 'Road point is outside the map');
      }
    });
  });

  const objectKeys = new Set(plan.objects.map((object) => object.assetKey));
  plan.objects.forEach((object, index) => {
    if (object.size.width <= 0) addIssue('invalid_dimension', ['objects', index, 'size', 'width'], 'Object width must be positive');
    if (object.size.height <= 0) addIssue('invalid_dimension', ['objects', index, 'size', 'height'], 'Object height must be positive');
  });

  const seenIds = new Set<string>();
  const registerId = (id: string, path: Array<string | number>) => {
    if (seenIds.has(id)) addIssue('duplicate_id', path, `Duplicate id: ${id}`);
    seenIds.add(id);
  };
  plan.objectInstances.forEach((instance, index) => {
    registerId(instance.id, ['objectInstances', index, 'id']);
    if (!objectKeys.has(instance.assetKey)) {
      addIssue('missing_object', ['objectInstances', index, 'assetKey'], `Unknown object: ${instance.assetKey}`);
    }
    if (!isPointInsideMap(instance.position, plan.map.width, plan.map.height)) {
      addIssue('outside_map', ['objectInstances', index, 'position'], 'Object is outside the map');
    }
    if (instance.scale <= 0) addIssue('invalid_dimension', ['objectInstances', index, 'scale'], 'Object scale must be positive');
  });

  plan.obstacles.forEach((obstacle, index) => {
    registerId(obstacle.id, ['obstacles', index, 'id']);
    if (obstacle.shape === 'rectangle') {
      if (obstacle.width <= 0 || obstacle.height <= 0) {
        addIssue('invalid_dimension', ['obstacles', index], 'Rectangle dimensions must be positive');
      }
      const corners = [
        { x: obstacle.x, y: obstacle.y },
        { x: obstacle.x + obstacle.width, y: obstacle.y + obstacle.height },
      ];
      if (corners.some((point) => !isPointInsideMap(point, plan.map.width, plan.map.height))) {
        addIssue('outside_map', ['obstacles', index], 'Rectangle is outside the map');
      }
    } else if (obstacle.shape === 'circle') {
      if (obstacle.radius <= 0) addIssue('invalid_dimension', ['obstacles', index, 'radius'], 'Circle radius must be positive');
      if (
        obstacle.cx - obstacle.radius < 0 ||
        obstacle.cy - obstacle.radius < 0 ||
        obstacle.cx + obstacle.radius > plan.map.width ||
        obstacle.cy + obstacle.radius > plan.map.height
      ) {
        addIssue('outside_map', ['obstacles', index], 'Circle is outside the map');
      }
    } else {
      if (obstacle.points.length < 3 || polygonArea(obstacle.points) <= Number.EPSILON) {
        addIssue('invalid_polygon', ['obstacles', index, 'points'], 'Polygon requires three non-collinear points');
      }
      if (obstacle.points.some((point) => !isPointInsideMap(point, plan.map.width, plan.map.height))) {
        addIssue('outside_map', ['obstacles', index, 'points'], 'Polygon is outside the map');
      }
    }
  });

  return issues.length > 0 ? { success: false, issues } : { success: true, data: plan };
}

const ResourceNameSchema = z.string().trim().min(1).max(120);
const PositiveSizeSchema = z
  .object({
    width: z.number().finite().positive(),
    height: z.number().finite().positive(),
  })
  .strict();

export const LocalRectangleCollisionSchema = z
  .object({
    shape: z.literal('rectangle'),
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().finite().positive(),
    height: z.number().finite().positive(),
  })
  .strict();

export const LocalCircleCollisionSchema = z
  .object({
    shape: z.literal('circle'),
    cx: z.number().finite(),
    cy: z.number().finite(),
    radius: z.number().finite().positive(),
  })
  .strict();

export const LocalPolygonCollisionSchema = z
  .object({
    shape: z.literal('polygon'),
    points: z.array(PointSchema).min(3),
  })
  .strict();

export const LocalCollisionShapeSchema = z.discriminatedUnion('shape', [
  LocalRectangleCollisionSchema,
  LocalCircleCollisionSchema,
  LocalPolygonCollisionSchema,
]);

export type LocalCollisionShape = z.infer<typeof LocalCollisionShapeSchema>;

export const TerrainRegionSchema = z
  .object({
    id: z.string().min(1).max(96),
    terrainKey: AssetKeySchema,
    points: z.array(PointSchema).min(3),
  })
  .strict();

export type TerrainRegion = z.infer<typeof TerrainRegionSchema>;

export const BackgroundPathSchema = z
  .object({
    id: z.string().min(1).max(96),
    name: ResourceNameSchema,
    prompt: ResourcePromptSchema,
    kind: z.enum(['road', 'river']),
    assetKey: AssetKeySchema,
    terrainKey: AssetKeySchema,
    width: z.number().finite().positive(),
    zIndex: z.number().int(),
    points: z.array(PointSchema).min(2),
  })
  .strict();

export type BackgroundPath = z.infer<typeof BackgroundPathSchema>;

export const TerrainAssetPlanSchema = z
  .object({
    assetKey: AssetKeySchema,
    name: ResourceNameSchema,
    prompt: ResourcePromptSchema,
  })
  .strict();

export type TerrainAssetPlan = z.infer<typeof TerrainAssetPlanSchema>;

export const ObstacleAssetPlanSchema = z
  .object({
    assetKey: AssetKeySchema,
    name: ResourceNameSchema,
    prompt: ResourcePromptSchema,
    size: PositiveSizeSchema,
    groundAnchor: PointSchema,
  })
  .strict();

export type ObstacleAssetPlan = z.infer<typeof ObstacleAssetPlanSchema>;

export const PlannedObstacleEntitySchema = z
  .object({
    id: z.string().min(1).max(96),
    assetKey: AssetKeySchema,
    position: PointSchema,
    scale: z.number().finite().positive(),
    rotation: z.number().finite(),
    zIndex: z.number().int(),
    collision: LocalCollisionShapeSchema,
  })
  .strict();

export type PlannedObstacleEntity = z.infer<typeof PlannedObstacleEntitySchema>;

export const MapPlanV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    name: z.string().trim().min(1).max(160),
    visualBrief: z.string().trim().min(1).max(4_000),
    map: z
      .object({
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        tileSize: z.union([z.literal(16), z.literal(32), z.literal(48), z.literal(64)]),
        projection: z.literal('top-down'),
      })
      .strict(),
    background: z
      .object({
        stylePrompt: ResourcePromptSchema,
        palette: z.array(z.string().trim().min(1).max(32)).min(1).max(16),
        baseTerrainKey: AssetKeySchema,
        regions: z.array(TerrainRegionSchema),
        paths: z.array(BackgroundPathSchema),
      })
      .strict(),
    terrains: z.array(TerrainAssetPlanSchema).min(1),
    obstacleAssets: z.array(ObstacleAssetPlanSchema),
    obstaclePlacements: z.array(PlannedObstacleEntitySchema),
  })
  .strict();

export type MapPlanV2 = z.infer<typeof MapPlanV2Schema>;

export type MapPlanV2IssueCode =
  | 'invalid_schema'
  | 'invalid_dimension'
  | 'missing_terrain'
  | 'missing_obstacle_asset'
  | 'duplicate_asset_key'
  | 'duplicate_id'
  | 'invalid_polygon'
  | 'outside_map';

export type MapPlanV2Issue = {
  code: MapPlanV2IssueCode;
  path: Array<string | number>;
  message: string;
};

export type MapPlanV2ValidationResult =
  | { success: true; data: MapPlanV2 }
  | { success: false; issues: MapPlanV2Issue[] };

function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const cross = (p: Point, q: Point, r: Point) =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  return abC * abD < 0 && cdA * cdB < 0;
}

function isSelfIntersecting(points: Point[]): boolean {
  for (let first = 0; first < points.length; first += 1) {
    const firstNext = (first + 1) % points.length;
    for (let second = first + 1; second < points.length; second += 1) {
      const secondNext = (second + 1) % points.length;
      if (first === second || firstNext === second || secondNext === first) continue;
      if (segmentsIntersect(points[first], points[firstNext], points[second], points[secondNext])) return true;
    }
  }
  return false;
}

function isValidLocalPolygon(collision: LocalCollisionShape): boolean {
  return collision.shape !== 'polygon' ||
    (polygonArea(collision.points) > Number.EPSILON && !isSelfIntersecting(collision.points));
}

export function validateMapPlanV2(input: unknown): MapPlanV2ValidationResult {
  const parsed = MapPlanV2Schema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      issues: parsed.error.issues.map((issue) => ({
        code: 'invalid_schema',
        path: issue.path,
        message: issue.message,
      })),
    };
  }

  const plan = parsed.data;
  const issues: MapPlanV2Issue[] = [];
  const addIssue = (code: MapPlanV2IssueCode, path: Array<string | number>, message: string) => {
    issues.push({ code, path, message });
  };

  if (plan.map.width % plan.map.tileSize !== 0) {
    addIssue('invalid_dimension', ['map', 'width'], 'Map width must be divisible by tile size');
  }
  if (plan.map.height % plan.map.tileSize !== 0) {
    addIssue('invalid_dimension', ['map', 'height'], 'Map height must be divisible by tile size');
  }

  const seenAssetKeys = new Set<string>();
  const registerAssetKey = (key: string, path: Array<string | number>) => {
    if (seenAssetKeys.has(key)) addIssue('duplicate_asset_key', path, `Duplicate asset key: ${key}`);
    seenAssetKeys.add(key);
  };
  plan.terrains.forEach((terrain, index) => registerAssetKey(terrain.assetKey, ['terrains', index, 'assetKey']));
  plan.background.paths.forEach((path, index) => registerAssetKey(path.assetKey, ['background', 'paths', index, 'assetKey']));
  plan.obstacleAssets.forEach((asset, index) => registerAssetKey(asset.assetKey, ['obstacleAssets', index, 'assetKey']));

  const terrainKeys = new Set(plan.terrains.map((terrain) => terrain.assetKey));
  if (!terrainKeys.has(plan.background.baseTerrainKey)) {
    addIssue('missing_terrain', ['background', 'baseTerrainKey'], `Unknown terrain: ${plan.background.baseTerrainKey}`);
  }

  const seenIds = new Set<string>();
  const registerId = (id: string, path: Array<string | number>) => {
    if (seenIds.has(id)) addIssue('duplicate_id', path, `Duplicate id: ${id}`);
    seenIds.add(id);
  };

  plan.background.regions.forEach((region, regionIndex) => {
    registerId(region.id, ['background', 'regions', regionIndex, 'id']);
    if (!terrainKeys.has(region.terrainKey)) {
      addIssue('missing_terrain', ['background', 'regions', regionIndex, 'terrainKey'], `Unknown terrain: ${region.terrainKey}`);
    }
    if (polygonArea(region.points) <= Number.EPSILON || isSelfIntersecting(region.points)) {
      addIssue('invalid_polygon', ['background', 'regions', regionIndex, 'points'], 'Region requires a non-self-intersecting polygon with positive area');
    }
    region.points.forEach((point, pointIndex) => {
      if (!isPointInsideMap(point, plan.map.width, plan.map.height)) {
        addIssue('outside_map', ['background', 'regions', regionIndex, 'points', pointIndex], 'Region point is outside the map');
      }
    });
  });

  plan.background.paths.forEach((path, pathIndex) => {
    registerId(path.id, ['background', 'paths', pathIndex, 'id']);
    if (!terrainKeys.has(path.terrainKey)) {
      addIssue('missing_terrain', ['background', 'paths', pathIndex, 'terrainKey'], `Unknown terrain: ${path.terrainKey}`);
    }
    path.points.forEach((point, pointIndex) => {
      if (!isPointInsideMap(point, plan.map.width, plan.map.height)) {
        addIssue('outside_map', ['background', 'paths', pathIndex, 'points', pointIndex], 'Path point is outside the map');
      }
    });
  });

  const obstacleAssetKeys = new Set(plan.obstacleAssets.map((asset) => asset.assetKey));
  plan.obstacleAssets.forEach((asset, assetIndex) => {
    if (asset.groundAnchor.x < 0 || asset.groundAnchor.y < 0 ||
      asset.groundAnchor.x > asset.size.width || asset.groundAnchor.y > asset.size.height) {
      addIssue('invalid_dimension', ['obstacleAssets', assetIndex, 'groundAnchor'], 'Ground anchor must be inside the obstacle asset bounds');
    }
  });

  plan.obstaclePlacements.forEach((placement, placementIndex) => {
    registerId(placement.id, ['obstaclePlacements', placementIndex, 'id']);
    if (!obstacleAssetKeys.has(placement.assetKey)) {
      addIssue('missing_obstacle_asset', ['obstaclePlacements', placementIndex, 'assetKey'], `Unknown obstacle asset: ${placement.assetKey}`);
    }
    if (!isPointInsideMap(placement.position, plan.map.width, plan.map.height)) {
      addIssue('outside_map', ['obstaclePlacements', placementIndex, 'position'], 'Obstacle placement is outside the map');
    }
    if (!isValidLocalPolygon(placement.collision)) {
      addIssue('invalid_polygon', ['obstaclePlacements', placementIndex, 'collision', 'points'], 'Collision polygon must be non-self-intersecting with positive area');
    }
  });

  return issues.length > 0 ? { success: false, issues } : { success: true, data: plan };
}
