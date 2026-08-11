import { z } from 'zod';
import {
  LocalCollisionShapeSchema,
  MapPlanSchema,
  ObstacleSchema,
  PointSchema,
  validateMapPlanV2,
  type MapPlanV2,
} from './mapPlanSchema';

type JsonSafeValue =
  | string
  | number
  | boolean
  | null
  | JsonSafeValue[]
  | { [key: string]: JsonSafeValue };

const CREDENTIAL_KEY_NAMES = new Set([
  'apikey',
  'accesstoken',
  'authtoken',
  'authorization',
  'bearer',
  'bearertoken',
  'clientsecret',
  'credential',
  'credentials',
  'idtoken',
  'oauth',
  'password',
  'privatekey',
  'refreshtoken',
  'secret',
  'sessiontoken',
  'token',
]);

const SIGNED_URL_KEY_NAMES = new Set([
  'presignedurl',
  'signedlink',
  'signeduri',
  'signedurl',
  'templink',
  'tempurl',
  'temporarylink',
  'temporaryurl',
]);

const SIGNED_URL_QUERY_KEYS = new Set([
  'googleaccessid',
  'key-pair-id',
  'policy',
  'signature',
  'x-amz-algorithm',
  'x-amz-credential',
  'x-amz-security-token',
  'x-amz-signature',
  'x-goog-algorithm',
  'x-goog-credential',
  'x-goog-signature',
]);

function normalizedJsonKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

function isSensitiveJsonKey(key: string): boolean {
  const normalized = normalizedJsonKey(key);
  return CREDENTIAL_KEY_NAMES.has(normalized) ||
    SIGNED_URL_KEY_NAMES.has(normalized) ||
    /(?:apikey|accesstoken|credential|password|privatekey|secret|token)$/.test(normalized) ||
    /^(?:url|uri|link)(?:signature|token|expires)$/.test(normalized) ||
    /(?:presigned|signed|temporary|temp)(?:url|uri|link)$/.test(normalized);
}

function isTemporarySignedUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') &&
      [...url.searchParams.keys()].some((key) => SIGNED_URL_QUERY_KEYS.has(key.toLowerCase()));
  } catch {
    return false;
  }
}

function addJsonIssue(context: z.RefinementCtx, path: Array<string | number>, message: string): void {
  context.addIssue({
    code: z.ZodIssueCode.custom,
    path,
    message,
  });
}

function validateJsonSafeValue(
  value: unknown,
  context: z.RefinementCtx,
  path: Array<string | number> = [],
  ancestors = new WeakSet<object>()
): void {
  if (value === null || typeof value === 'boolean') return;

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) addJsonIssue(context, path, 'Value must be a finite JSON number');
    return;
  }

  if (typeof value === 'string') {
    if (isTemporarySignedUrl(value)) {
      addJsonIssue(context, path, 'Temporary signed URLs cannot be stored in durable asset records');
    }
    return;
  }

  if (typeof value !== 'object') {
    addJsonIssue(context, path, 'Value must be JSON-safe');
    return;
  }

  if (ancestors.has(value)) {
    addJsonIssue(context, path, 'Circular values are not JSON-safe');
    return;
  }

  ancestors.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => validateJsonSafeValue(entry, context, [...path, index], ancestors));
  } else if (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null) {
    Object.entries(value).forEach(([key, entry]) => {
      if (isSensitiveJsonKey(key)) {
        addJsonIssue(context, [...path, key], 'Credential and signed URL fields cannot be stored in durable asset records');
      } else {
        validateJsonSafeValue(entry, context, [...path, key], ancestors);
      }
    });
  } else {
    addJsonIssue(context, path, 'Value must be a plain JSON object or array');
  }
  ancestors.delete(value);
}

const JsonSafeRecordSchema = z
  .unknown()
  .superRefine((value, context) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
      addJsonIssue(context, [], 'Value must be a plain JSON object');
      return;
    }
    validateJsonSafeValue(value, context);
  })
  .transform((value) => value as { [key: string]: JsonSafeValue });

const StorageObjectKeySchema = z
  .string()
  .min(1)
  .max(1_024)
  .refine(
    (value) => {
      if (value.startsWith('/') || value.startsWith('\\') || value.includes('?') || value.includes('\\')) return false;
      if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return false;
      return value.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
    },
    'Storage path must be an internal storage object key'
  );

export const SceneLayerSchema = z
  .object({
    id: z.string().min(1).max(96),
    name: z.string().trim().min(1).max(120),
    kind: z.enum(['terrain', 'objects', 'overlay']),
    visible: z.boolean(),
    locked: z.boolean(),
  })
  .strict();

export type SceneLayer = z.infer<typeof SceneLayerSchema>;

export const TilePlacementSchema = z
  .object({
    id: z.string().min(1).max(96),
    layerId: z.string().min(1).max(96),
    terrainKey: z.string().min(1).max(96),
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
    wangIndex: z.number().int().nonnegative(),
  })
  .strict();

export type TilePlacement = z.infer<typeof TilePlacementSchema>;

export const ObjectInstanceSchema = z
  .object({
    id: z.string().min(1).max(96),
    layerId: z.string().min(1).max(96),
    assetKey: z.string().min(1).max(96),
    position: PointSchema,
    scale: z.number().finite().positive(),
    rotation: z.number().finite(),
    zIndex: z.number().int(),
    groundAnchor: PointSchema,
    movable: z.boolean(),
  })
  .strict();

export type ObjectInstance = z.infer<typeof ObjectInstanceSchema>;

export const MapSceneSchema = z
  .object({
    schemaVersion: z.literal(1),
    size: z
      .object({
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        tileSize: z.number().int().positive(),
      })
      .strict(),
    layers: z.array(SceneLayerSchema),
    tiles: z.array(TilePlacementSchema),
    objects: z.array(ObjectInstanceSchema),
    obstacles: z.array(ObstacleSchema),
    canvas: z
      .object({
        zoom: z.number().finite().positive(),
        panX: z.number().finite(),
        panY: z.number().finite(),
        snapToGrid: z.boolean(),
      })
      .strict(),
  })
  .strict();

export type MapScene = z.infer<typeof MapSceneSchema>;

export const SceneLayerV2Schema = z
  .object({
    id: z.enum(['background', 'obstacles', 'collision']),
    name: z.string().trim().min(1).max(120),
    kind: z.enum(['background', 'obstacles', 'collision']),
    visible: z.boolean(),
    locked: z.boolean(),
  })
  .strict()
  .refine((layer) => layer.id === layer.kind, {
    message: 'Layer id and kind must match',
    path: ['kind'],
  });

export type SceneLayerV2 = z.infer<typeof SceneLayerV2Schema>;

export const LockedBackgroundBindingSchema = z
  .object({
    layerId: z.literal('background'),
    assetKey: z.string().min(1).max(96),
    sourceRevisionId: z.string().uuid(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    locked: z.literal(true),
  })
  .strict();

export type LockedBackgroundBinding = z.infer<typeof LockedBackgroundBindingSchema>;

export const ObstacleEntitySchema = z
  .object({
    id: z.string().min(1).max(96),
    layerId: z.literal('obstacles'),
    assetKey: z.string().min(1).max(96),
    position: PointSchema,
    scale: z.number().finite().positive(),
    rotation: z.number().finite(),
    zIndex: z.number().int(),
    groundAnchor: PointSchema,
    collision: LocalCollisionShapeSchema,
    source: z.enum(['plan', 'region-generation', 'manual']),
  })
  .strict();

export type ObstacleEntity = z.infer<typeof ObstacleEntitySchema>;

export const CanvasStateV2Schema = z
  .object({
    zoom: z.number().finite().positive(),
    panX: z.number().finite(),
    panY: z.number().finite(),
    snapToGrid: z.boolean(),
  })
  .strict();

export type CanvasStateV2 = z.infer<typeof CanvasStateV2Schema>;

export const MapSceneV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    size: z
      .object({
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        tileSize: z.number().int().positive(),
      })
      .strict(),
    background: LockedBackgroundBindingSchema.nullable(),
    layers: z.array(SceneLayerV2Schema),
    obstacleEntities: z.array(ObstacleEntitySchema),
    canvas: CanvasStateV2Schema,
  })
  .strict();

export type MapSceneV2 = z.infer<typeof MapSceneV2Schema>;
export type MapAssetKind = 'terrain' | 'path' | 'obstacle' | 'background';

export type MapSceneV2IssueCode =
  | 'invalid_schema'
  | 'dimension_mismatch'
  | 'invalid_layer'
  | 'missing_background'
  | 'invalid_background'
  | 'missing_obstacle_asset'
  | 'duplicate_id'
  | 'invalid_collision'
  | 'outside_map';

export type MapSceneV2Issue = {
  code: MapSceneV2IssueCode;
  path: Array<string | number>;
  message: string;
};

export type MapSceneV2ValidationResult =
  | { success: true; data: MapSceneV2 }
  | { success: false; issues: MapSceneV2Issue[] };

function collisionPolygonArea(points: Array<{ x?: number; y?: number }>): number {
  return Math.abs(points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + Number(point.x) * Number(next.y) - Number(next.x) * Number(point.y);
  }, 0) / 2);
}

export function validateMapSceneV2(planInput: MapPlanV2, sceneInput: unknown): MapSceneV2ValidationResult {
  const parsedPlan = validateMapPlanV2(planInput);
  if (parsedPlan.success === false) {
    return {
      success: false,
      issues: parsedPlan.issues.map((issue) => ({
        code: 'invalid_schema',
        path: ['plan', ...issue.path],
        message: issue.message,
      })),
    };
  }

  const parsedScene = MapSceneV2Schema.safeParse(sceneInput);
  if (!parsedScene.success) {
    return {
      success: false,
      issues: parsedScene.error.issues.map((issue) => ({
        code: 'invalid_schema',
        path: issue.path,
        message: issue.message,
      })),
    };
  }

  const plan = parsedPlan.data;
  const scene = parsedScene.data;
  const issues: MapSceneV2Issue[] = [];
  const addIssue = (code: MapSceneV2IssueCode, path: Array<string | number>, message: string) => {
    issues.push({ code, path, message });
  };

  if (scene.size.width !== plan.map.width) {
    addIssue('dimension_mismatch', ['size', 'width'], 'Scene width must match Plan width');
  }
  if (scene.size.height !== plan.map.height) {
    addIssue('dimension_mismatch', ['size', 'height'], 'Scene height must match Plan height');
  }
  if (scene.size.tileSize !== plan.map.tileSize) {
    addIssue('dimension_mismatch', ['size', 'tileSize'], 'Scene tile size must match Plan tile size');
  }

  const expectedLayers = new Set(['background', 'obstacles', 'collision']);
  const seenLayers = new Set<string>();
  scene.layers.forEach((layer, index) => {
    if (seenLayers.has(layer.id)) addIssue('invalid_layer', ['layers', index, 'id'], `Duplicate layer: ${layer.id}`);
    seenLayers.add(layer.id);
    if (!expectedLayers.has(layer.id)) addIssue('invalid_layer', ['layers', index, 'id'], `Unexpected layer: ${layer.id}`);
    if (layer.id === 'background' && !layer.locked) {
      addIssue('invalid_layer', ['layers', index, 'locked'], 'Background layer must be locked');
    }
  });
  expectedLayers.forEach((layerId) => {
    if (!seenLayers.has(layerId)) addIssue('invalid_layer', ['layers'], `Missing fixed layer: ${layerId}`);
  });

  if (scene.background === null) {
    if (scene.obstacleEntities.length > 0) {
      addIssue('missing_background', ['background'], 'Obstacle-bearing Scenes require a locked background');
    }
  } else if (scene.background.width !== scene.size.width || scene.background.height !== scene.size.height) {
    addIssue('invalid_background', ['background'], 'Background dimensions must match Scene dimensions');
  }

  const obstacleAssetKeys = new Set(plan.obstacleAssets.map((asset) => asset.assetKey));
  const seenEntityIds = new Set<string>();
  scene.obstacleEntities.forEach((entity, index) => {
    if (seenEntityIds.has(entity.id)) {
      addIssue('duplicate_id', ['obstacleEntities', index, 'id'], `Duplicate obstacle entity id: ${entity.id}`);
    }
    seenEntityIds.add(entity.id);
    if (entity.source === 'plan' && !obstacleAssetKeys.has(entity.assetKey)) {
      addIssue('missing_obstacle_asset', ['obstacleEntities', index, 'assetKey'], `Unknown obstacle asset: ${entity.assetKey}`);
    }
    if (entity.collision.shape === 'polygon' && collisionPolygonArea(entity.collision.points) <= Number.EPSILON) {
      addIssue('invalid_collision', ['obstacleEntities', index, 'collision', 'points'], 'Collision polygon must have positive area');
    }
    if (entity.position.x < 0 || entity.position.y < 0 ||
      entity.position.x > scene.size.width || entity.position.y > scene.size.height) {
      addIssue('outside_map', ['obstacleEntities', index, 'position'], 'Obstacle entity is outside the map');
    }
  });

  return issues.length > 0 ? { success: false, issues } : { success: true, data: scene };
}

export const MapRevisionRecordSchema = z
  .object({
    id: z.string().uuid(),
    mapProjectId: z.string().uuid(),
    revisionNumber: z.number().int().positive(),
    saveVersion: z.number().int().nonnegative(),
    parentRevisionId: z.string().uuid().nullable(),
    sourceDocumentId: z.string().uuid(),
    sourceDocumentUpdatedAt: z.string().datetime(),
    sourceEpoch: z.number().int().nonnegative(),
    sourceRevision: z.number().int().nonnegative(),
    schemaVersion: z.literal(1),
    plan: MapPlanSchema,
    scene: MapSceneSchema,
    status: z.enum(['draft', 'generating', 'partial', 'ready', 'failed']),
    createdBy: z.string().uuid(),
    createdAt: z.string().datetime(),
  })
  .strict();

export type MapRevisionRecord = z.infer<typeof MapRevisionRecordSchema>;

export const MapAssetRecordSchema = z
  .object({
    id: z.string().uuid(),
    mapRevisionId: z.string().uuid(),
    assetKey: z.string().min(1).max(96),
    kind: z.enum(['terrain', 'road', 'object', 'inpaint']),
    status: z.enum(['planned', 'queued', 'generating', 'ready', 'failed', 'blocked']),
    requestedCapability: z.string().min(1).nullable(),
    providerOperation: z.string().min(1).nullable(),
    providerTransport: z.enum(['mcp', 'rest']).nullable(),
    prompt: z.string().min(1).max(2_000),
    generationParams: JsonSafeRecordSchema,
    referenceAssetIds: z.array(z.string().uuid()),
    referenceHashes: z.array(z.string().regex(/^[a-f0-9]{64}$/)),
    providerJobId: z.string().min(1).nullable(),
    attemptCount: z.number().int().nonnegative(),
    lastErrorCode: z.string().min(1).nullable(),
    storagePath: StorageObjectKeySchema.nullable(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
    width: z.number().int().positive().nullable(),
    height: z.number().int().positive().nullable(),
    hasTransparency: z.boolean().nullable(),
    metadata: JsonSafeRecordSchema,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export type MapAssetRecord = z.infer<typeof MapAssetRecordSchema>;
