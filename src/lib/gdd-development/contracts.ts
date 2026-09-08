import { z } from 'zod';
import { gameArtStyleSnapshotSchema } from '@/lib/game-art-style/schema';

const uuid = z.string().uuid();
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const nullableDimension = z.number().int().positive().max(16_384).nullable();

export const developmentTargetProfileSchema = z.object({
  engine: z.literal('godot-4'),
  assetKind: z.enum(['background', 'map_image', 'character', 'sprite', 'animation', 'tileset', 'ui', 'effect']),
  width: z.number().int().positive().max(16_384).optional(),
  height: z.number().int().positive().max(16_384).optional(),
  transparent: z.boolean().optional(),
  tileSize: z.number().int().positive().max(1_024).optional(),
  frameWidth: z.number().int().positive().max(16_384).optional(),
  frameHeight: z.number().int().positive().max(16_384).optional(),
  frameCount: z.number().int().positive().max(4_096).optional(),
}).strict();

export const runtimeCompatibilitySchema = z.object({
  status: z.enum(['compatible', 'incompatible', 'unknown']),
  targetProfileHash: sha256.nullable(),
  reasons: z.array(z.string().trim().min(1).max(300)).max(20),
}).strict();

export const gddDevelopmentAssetSchema = z.object({
  sourceType: z.enum(['gdd_map_artifact', 'resource_reference', 'markdown_image']),
  sourceId: z.string().trim().min(1).max(2_048).nullable(),
  label: z.string().trim().max(500).nullable(),
  assetId: uuid.nullable(),
  revisionId: uuid.nullable(),
  sha256: sha256.nullable(),
  kind: z.enum(['map_image', 'image', 'unknown']),
  contentType: z.string().trim().min(1).max(120).nullable(),
  width: nullableDimension,
  height: nullableDimension,
  hasTransparency: z.boolean().nullable(),
  intendedRole: z.enum(['runtime_asset', 'runtime_candidate', 'style_reference', 'layout_reference', 'concept_only', 'unclassified']),
  runtimeCompatibility: runtimeCompatibilitySchema,
  delivery: z.object({
    imageUrl: z.string().url().max(4_096),
    expiresAt: z.string().datetime().nullable(),
    ephemeral: z.literal(true),
  }).strict().nullable(),
}).strict();

const previewReferenceSchema = z.object({
  publicPath: z.string().startsWith('/').max(1_024),
  sha256,
  width: z.number().int().positive().max(16_384),
  height: z.number().int().positive().max(16_384),
  intendedRole: z.literal('concept_only'),
}).strict();

export const developmentContextWarningSchema = z.object({
  code: z.enum(['ORIGIN_UNAVAILABLE', 'ART_STYLE_UNSUPPORTED', 'ASSET_UNAVAILABLE', 'IMAGE_UNCLASSIFIED']),
  sourceId: z.string().trim().max(2_048).nullable(),
  message: z.string().trim().min(1).max(500),
}).strict();

export const gddDevelopmentContextSchema = z.object({
  document: z.object({
    id: uuid,
    epoch: z.number().int().nonnegative(),
    revision: z.number().int().nonnegative(),
    contentHash: sha256,
    updatedAt: z.string().datetime(),
  }).strict(),
  origin: z.object({
    generationJobId: uuid,
    designSystemId: uuid,
    versionId: uuid,
    versionNumber: z.number().int().positive(),
    versionContentHash: sha256,
  }).strict().nullable(),
  artStyle: z.object({
    snapshot: gameArtStyleSnapshotSchema,
    contentHash: sha256,
    previewReferences: z.array(previewReferenceSchema).max(10),
  }).strict().nullable(),
  assets: z.array(gddDevelopmentAssetSchema).max(200),
  warnings: z.array(developmentContextWarningSchema).max(200),
}).strict();

export type DevelopmentTargetProfile = z.infer<typeof developmentTargetProfileSchema>;
export type GddDevelopmentAsset = z.infer<typeof gddDevelopmentAssetSchema>;
export type GddDevelopmentContext = z.infer<typeof gddDevelopmentContextSchema>;
export type DevelopmentContextWarning = z.infer<typeof developmentContextWarningSchema>;

export function stripGddDevelopmentContextDelivery(context: GddDevelopmentContext): GddDevelopmentContext {
  return {
    ...context,
    assets: context.assets.map((asset) => ({ ...asset, delivery: null })),
  };
}
