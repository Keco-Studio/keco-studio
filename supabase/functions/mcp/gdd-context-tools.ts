import type { McpServer } from '@mcp/server/mcp.js';
import { z } from 'zod';
import { callKecoApp, type KecoAppRequest } from './app-bridge.ts';
import type { McpRequestContext } from './context.ts';
import { McpDomainError } from './errors.ts';
import { toolFailure, toolSuccess } from './results.ts';

type AppCaller = (context: McpRequestContext, request: KecoAppRequest) => Promise<unknown>;
type Dependencies = { callApp?: AppCaller };
const uuid = z.string().uuid();
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.string().datetime({ offset: true });
const targetProfileSchema = z.object({
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
const previewAssetSchema = z.object({
  sourcePath: z.string().regex(/^public\/game-art-styles\//).max(1_024),
  publicPath: z.string().regex(/^\/game-art-styles\//).max(1_024),
  width: z.number().int().positive().max(16_384),
  height: z.number().int().positive().max(16_384),
  alt: z.string().trim().min(1).max(500),
  sha256,
  bytes: z.number().int().positive(),
  alpha: z.enum(['opaque', 'transparent']),
}).strict();
const specificationSchema = z.object(Object.fromEntries([
  'visualIdentity', 'pixelTechnique', 'shapeLanguage', 'paletteAndLighting',
  'characterDirection', 'environmentDirection', 'propDirection',
  'effectsDirection', 'uiHudDirection', 'animationDirection', 'accessibility',
].map((field) => [field, z.string().min(1).max(2_000)])) as Record<string, z.ZodString>).strict();
const snapshotSchema = z.object({
  schemaVersion: z.literal(1),
  presetId: z.string().min(1).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  presetVersion: z.number().int().positive(),
  title: z.string().trim().min(1).max(120),
  previewAssetSet: z.object({
    id: z.string().trim().min(1).max(120),
    map: previewAssetSchema,
    character: previewAssetSchema,
    supporting: z.array(previewAssetSchema).max(8),
  }).strict(),
  specification: specificationSchema,
  customization: z.object({
    direction: z.string().max(2_000),
    referenceGames: z.array(z.object({
      name: z.string().min(1).max(120),
      borrow: z.string().min(1).max(500),
    }).strict()).max(8),
    avoid: z.string().max(1_000),
  }).strict(),
}).strict().refine((value) => new TextEncoder().encode(JSON.stringify(value)).byteLength <= 32 * 1_024);
const contextSchema = z.object({
  document: z.object({
    id: uuid,
    epoch: z.number().int().nonnegative(),
    revision: z.number().int().nonnegative(),
    contentHash: sha256,
    updatedAt: timestamp,
  }).strict(),
  origin: z.object({
    generationJobId: uuid,
    designSystemId: uuid,
    versionId: uuid,
    versionNumber: z.number().int().positive(),
    versionContentHash: sha256,
  }).strict().nullable(),
  artStyle: z.object({
    snapshot: snapshotSchema,
    contentHash: sha256,
    previewReferences: z.array(z.object({
      publicPath: z.string().startsWith('/').max(1_024),
      sha256,
      width: z.number().int().positive().max(16_384),
      height: z.number().int().positive().max(16_384),
      intendedRole: z.literal('concept_only'),
    }).strict()).max(10),
  }).strict().nullable(),
  assets: z.array(z.object({
    sourceType: z.enum(['gdd_map_artifact', 'resource_reference', 'markdown_image']),
    sourceId: z.string().trim().min(1).max(2_048).nullable(),
    label: z.string().trim().max(500).nullable(),
    assetId: uuid.nullable(),
    revisionId: uuid.nullable(),
    sha256: sha256.nullable(),
    kind: z.enum(['map_image', 'image', 'unknown']),
    contentType: z.string().trim().min(1).max(120).nullable(),
    width: z.number().int().positive().max(16_384).nullable(),
    height: z.number().int().positive().max(16_384).nullable(),
    hasTransparency: z.boolean().nullable(),
    intendedRole: z.enum(['runtime_asset', 'runtime_candidate', 'style_reference', 'layout_reference', 'concept_only', 'unclassified']),
    runtimeCompatibility: z.object({
      status: z.enum(['compatible', 'incompatible', 'unknown']),
      targetProfileHash: sha256.nullable(),
      reasons: z.array(z.string().trim().min(1).max(300)).max(20),
    }).strict(),
    delivery: z.object({ imageUrl: z.string().url().max(4_096), expiresAt: timestamp.nullable(), ephemeral: z.literal(true) }).strict().nullable(),
  }).strict()).max(200),
  warnings: z.array(z.object({
    code: z.enum(['ORIGIN_UNAVAILABLE', 'ART_STYLE_UNSUPPORTED', 'ASSET_UNAVAILABLE', 'IMAGE_UNCLASSIFIED']),
    sourceId: z.string().trim().max(2_048).nullable(),
    message: z.string().trim().min(1).max(500),
  }).strict()).max(200),
}).strict();

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function boundedContext(value: unknown): Record<string, unknown> {
  const parsed = contextSchema.safeParse(value);
  if (!parsed.success) {
    throw new McpDomainError('UPSTREAM_UNAVAILABLE', 'The Keco application returned an invalid GDD development context.', undefined, true);
  }
  return parsed.data;
}

export function registerGddContextTools(server: McpServer, context: McpRequestContext, dependencies: Dependencies = {}): void {
  const schema = z.object({
    ...(context.mode === 'account' ? { projectId: uuid } : {}),
    documentId: uuid,
    targetProfile: targetProfileSchema.optional(),
  }).strict();
  server.registerTool('read_gdd_development_context', {
    description: 'Read a GDD Document with its exact historical GDS Art Style, authoritative image inventory, and runtime compatibility.',
    inputSchema: schema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (input: z.infer<typeof schema>) => {
    try {
      const row = input as { projectId?: string; documentId: string; targetProfile?: z.infer<typeof targetProfileSchema> };
      const projectId = context.mode === 'project' ? context.projectId : row.projectId!;
      const query = row.targetProfile ? `?targetProfile=${encodeURIComponent(JSON.stringify(row.targetProfile))}` : '';
      const payload = record(await (dependencies.callApp ?? callKecoApp)(context, {
        method: 'GET',
        path: `/api/projects/${encodeURIComponent(projectId)}/gdd-development-context/${encodeURIComponent(row.documentId)}${query}`,
      }));
      return toolSuccess('GDD development context loaded.', { ok: true, context: boundedContext(payload.context) });
    } catch (error) {
      return toolFailure(error);
    }
  });
}
