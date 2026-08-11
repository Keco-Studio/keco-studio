import { describe, expect, it } from '@jest/globals';
import {
  MapAssetRecordSchema,
  MapRevisionRecordSchema,
  MapSceneSchema,
  MapSceneV2Schema,
  validateMapSceneV2,
} from '@/features/create-map/model/mapSceneSchema';
import {
  makeEmptyMapSceneV2,
  makeValidMapPlan,
  makeValidMapPlanV2,
  makeValidMapScene,
  makeValidMapSceneV2,
} from './fixtures';

describe('MapSceneSchema', () => {
  it('accepts ordered layers, tile placements, movable objects, obstacles, and canvas settings', () => {
    const scene = makeValidMapScene();
    const parsed = MapSceneSchema.parse(scene);

    expect(parsed.layers.map((layer) => layer.id)).toEqual(['terrain', 'objects', 'overlay']);
    expect(parsed.tiles[1]).toEqual(expect.objectContaining({ terrainKey: 'packed-earth', wangIndex: 5 }));
    expect(parsed.objects[0]).toEqual(
      expect.objectContaining({ movable: true, groundAnchor: { x: 32, y: 72 }, zIndex: 10 })
    );
    expect(parsed.canvas).toEqual({ zoom: 1, panX: 0, panY: 0, snapToGrid: true });
  });

  it('rejects browser-only or unknown durable scene fields', () => {
    const scene = makeValidMapScene() as unknown as Record<string, unknown>;
    scene.pointerCapture = { x: 10, y: 20 };

    expect(MapSceneSchema.safeParse(scene).success).toBe(false);
  });
});

describe('MapSceneV2Schema', () => {
  it('accepts an empty pre-generation Scene with no background', () => {
    const plan = makeValidMapPlanV2();
    const scene = makeEmptyMapSceneV2();

    expect(MapSceneV2Schema.parse(scene).background).toBeNull();
    expect(validateMapSceneV2(plan, scene)).toEqual({ success: true, data: scene });
  });

  it('accepts a materialized locked background with bound obstacle entities', () => {
    const plan = makeValidMapPlanV2();
    const scene = makeValidMapSceneV2();

    expect(validateMapSceneV2(plan, scene)).toEqual({ success: true, data: scene });
  });

  it('requires a background for obstacle-bearing Scenes', () => {
    const plan = makeValidMapPlanV2();
    const scene = makeValidMapSceneV2();
    scene.background = null;

    const result = validateMapSceneV2(plan, scene);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues).toContainEqual(expect.objectContaining({ code: 'missing_background' }));
    }
  });

  it('rejects dimension, fixed-layer, and obstacle asset mismatches', () => {
    const plan = makeValidMapPlanV2();
    const scene = makeValidMapSceneV2();
    scene.size.width += 32;
    scene.layers = scene.layers.filter((layer) => layer.id !== 'collision');
    scene.obstacleEntities[0].assetKey = 'missing-obstacle';
    scene.obstacleEntities[0].collision = {
      shape: 'polygon',
      points: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }],
    };

    const result = validateMapSceneV2(plan, scene);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
        'dimension_mismatch',
        'invalid_layer',
        'missing_obstacle_asset',
        'invalid_collision',
      ]));
    }
  });
});

describe('persistence record schemas', () => {
  it('accepts revision and asset records without signed preview URLs', () => {
    const revisionId = '00000000-0000-4000-8000-000000000001';
    const mapProjectId = '00000000-0000-4000-8000-000000000002';
    const sourceDocumentId = '00000000-0000-4000-8000-000000000003';
    const userId = '00000000-0000-4000-8000-000000000004';
    const assetId = '00000000-0000-4000-8000-000000000005';
    const createdAt = '2026-08-08T08:00:00.000Z';

    expect(
      MapRevisionRecordSchema.parse({
        id: revisionId,
        mapProjectId,
        revisionNumber: 1,
        saveVersion: 0,
        parentRevisionId: null,
        sourceDocumentId,
        sourceDocumentUpdatedAt: createdAt,
        sourceEpoch: 1,
        sourceRevision: 1,
        schemaVersion: 1,
        plan: makeValidMapPlan(),
        scene: makeValidMapScene(),
        status: 'draft',
        createdBy: userId,
        createdAt,
      }).id
    ).toBe(revisionId);

    const assetInput = {
      id: assetId,
      mapRevisionId: revisionId,
      assetKey: 'oak-tree',
      kind: 'object',
      status: 'planned',
      requestedCapability: 'create_map_object',
      providerOperation: null,
      providerTransport: null,
      prompt: 'A broad oak tree as a transparent top-down pixel art object.',
      generationParams: { width: 64, height: 80 },
      referenceAssetIds: [],
      referenceHashes: [],
      providerJobId: null,
      attemptCount: 0,
      lastErrorCode: null,
      storagePath: null,
      sha256: null,
      width: null,
      height: null,
      hasTransparency: null,
      metadata: {},
      createdAt,
      updatedAt: createdAt,
    };
    const asset = MapAssetRecordSchema.parse(assetInput);

    expect(asset.assetKey).toBe('oak-tree');
    expect(asset).not.toHaveProperty('signedUrl');
    expect(MapAssetRecordSchema.safeParse({ ...assetInput, signedUrl: 'https://example.test/private.png' }).success).toBe(
      false
    );
  });

  it.each([
    ['nested API key', { nested: { apiKey: 'should-not-persist' } }, {}],
    ['nested credential object', { settings: [{ credentials: { value: 'should-not-persist' } }] }, {}],
    ['nested signed URL key', {}, { output: { signedUrl: 'https://example.test/image.png' } }],
    ['AWS signed URL value', {}, { preview: 'https://bucket.example/image.png?X-Amz-Signature=signature' }],
    ['Google signed URL value', { response: { url: 'https://bucket.example/image.png?X-Goog-Signature=signature' } }, {}],
    ['CloudFront signed URL value', {}, { preview: 'https://cdn.example/image.png?Policy=policy&Signature=signature' }],
  ])('rejects %s at every metadata depth', (_label, generationParams, metadata) => {
    const assetInput = makeAssetRecordInput({ generationParams, metadata });

    expect(MapAssetRecordSchema.safeParse(assetInput).success).toBe(false);
  });

  it.each([
    '/maps/revision-1/oak-tree.png',
    'https://storage.example/maps/revision-1/oak-tree.png',
    'maps/revision-1/oak-tree.png?signature=temporary',
    'maps/revision-1/../oak-tree.png',
    '../maps/revision-1/oak-tree.png',
    'maps\\revision-1\\oak-tree.png',
  ])('rejects invalid storage object key %s', (storagePath) => {
    const assetInput = makeAssetRecordInput({ storagePath });

    expect(MapAssetRecordSchema.safeParse(assetInput).success).toBe(false);
  });

  it('preserves future-compatible ordinary JSON metadata and internal storage keys', () => {
    const asset = MapAssetRecordSchema.parse(
      makeAssetRecordInput({
        generationParams: {
          seed: 42,
          negativePrompt: 'no lettering',
          render: { passes: ['base', 'detail'], enabled: true },
        },
        metadata: {
          sourceUrl: 'https://example.test/style-guide',
          notes: ['keep the canopy readable'],
          nullableField: null,
        },
        storagePath: 'maps/revision-1/assets/oak-tree.png',
      })
    );

    expect(asset.storagePath).toBe('maps/revision-1/assets/oak-tree.png');
    expect(asset.metadata).toEqual(expect.objectContaining({ sourceUrl: 'https://example.test/style-guide' }));
  });
});

function makeAssetRecordInput(overrides: Record<string, unknown> = {}) {
  const revisionId = '00000000-0000-4000-8000-000000000001';
  const assetId = '00000000-0000-4000-8000-000000000005';
  const createdAt = '2026-08-08T08:00:00.000Z';

  return {
    id: assetId,
    mapRevisionId: revisionId,
    assetKey: 'oak-tree',
    kind: 'object',
    status: 'planned',
    requestedCapability: 'create_map_object',
    providerOperation: null,
    providerTransport: null,
    prompt: 'A broad oak tree as a transparent top-down pixel art object.',
    generationParams: { width: 64, height: 80 },
    referenceAssetIds: [],
    referenceHashes: [],
    providerJobId: null,
    attemptCount: 0,
    lastErrorCode: null,
    storagePath: null,
    sha256: null,
    width: null,
    height: null,
    hasTransparency: null,
    metadata: {},
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}
