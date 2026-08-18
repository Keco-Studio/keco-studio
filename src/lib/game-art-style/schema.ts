import { z } from 'zod';

export const GAME_ART_STYLE_MAX_BYTES = 32 * 1024;

const normalizeMultiline = (value: string): string => value
  .replace(/\r\n?/g, '\n')
  .split('\n')
  .map((line) => line.replace(/[ \t]+$/g, ''))
  .join('\n')
  .trim();

const normalizeName = (value: string): string => value.replace(/\s+/g, ' ').trim();

const rawReferenceGameSchema = z.object({
  name: z.string(),
  borrow: z.string(),
}).strict();

const normalizedReferenceGameSchema = z.object({
  name: z.string().min(1).max(120),
  borrow: z.string().min(1).max(500),
}).strict();

const presetIdSchema = z.string().min(1).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const presetVersionSchema = z.number().int().positive();

const rawInputSchema = z.object({
  presetId: presetIdSchema,
  presetVersion: presetVersionSchema,
  customization: z.object({
    direction: z.string().optional(),
    referenceGames: z.array(rawReferenceGameSchema).max(8),
    avoid: z.string().optional(),
  }).strict(),
}).strict();

export const gameArtStyleInputSchema = rawInputSchema.transform((input, context) => {
  const references: Array<z.infer<typeof normalizedReferenceGameSchema>> = [];
  const seen = new Set<string>();

  input.customization.referenceGames.forEach((reference, index) => {
    const normalized = {
      name: normalizeName(reference.name),
      borrow: normalizeMultiline(reference.borrow),
    };
    if (!normalized.name && !normalized.borrow) return;
    const parsed = normalizedReferenceGameSchema.safeParse(normalized);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        context.addIssue({
          ...issue,
          path: ['customization', 'referenceGames', index, ...issue.path],
        });
      }
      return;
    }
    const key = parsed.data.name.toLocaleLowerCase('en-US');
    if (seen.has(key)) return;
    seen.add(key);
    references.push(parsed.data);
  });

  const direction = normalizeMultiline(input.customization.direction ?? '');
  const avoid = normalizeMultiline(input.customization.avoid ?? '');
  if (direction.length > 2_000) {
    context.addIssue({ code: z.ZodIssueCode.too_big, maximum: 2_000, inclusive: true, type: 'string', path: ['customization', 'direction'], message: 'Custom direction must be 2,000 characters or fewer.' });
  }
  if (avoid.length > 1_000) {
    context.addIssue({ code: z.ZodIssueCode.too_big, maximum: 1_000, inclusive: true, type: 'string', path: ['customization', 'avoid'], message: 'Avoid guidance must be 1,000 characters or fewer.' });
  }

  return {
    presetId: input.presetId,
    presetVersion: input.presetVersion,
    customization: { direction, referenceGames: references, avoid },
  };
});

export const gameArtStylePreviewAssetSchema = z.object({
  sourcePath: z.string().regex(/^public\/game-art-styles\/.+/),
  publicPath: z.string().regex(/^\/game-art-styles\/.+/),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  alt: z.string().trim().min(1).max(500),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  bytes: z.number().int().positive(),
  alpha: z.enum(['opaque', 'transparent']),
}).strict();

export const gameArtStyleSpecificationSchema = z.object({
  visualIdentity: z.string().min(1).max(2_000),
  pixelTechnique: z.string().min(1).max(2_000),
  shapeLanguage: z.string().min(1).max(2_000),
  paletteAndLighting: z.string().min(1).max(2_000),
  characterDirection: z.string().min(1).max(2_000),
  environmentDirection: z.string().min(1).max(2_000),
  propDirection: z.string().min(1).max(2_000),
  effectsDirection: z.string().min(1).max(2_000),
  uiHudDirection: z.string().min(1).max(2_000),
  animationDirection: z.string().min(1).max(2_000),
  accessibility: z.string().min(1).max(2_000),
}).strict();

export const gameArtStylePresetSchema = z.object({
  schemaVersion: z.literal(1),
  presetId: presetIdSchema,
  presetVersion: presetVersionSchema,
  title: z.string().trim().min(1).max(120),
  previewAssetSet: z.object({
    id: z.string().trim().min(1).max(120),
    map: gameArtStylePreviewAssetSchema,
    character: gameArtStylePreviewAssetSchema,
    supporting: z.array(gameArtStylePreviewAssetSchema),
  }).strict(),
  specification: gameArtStyleSpecificationSchema,
}).strict();

export const gameArtStyleSnapshotSchema = gameArtStylePresetSchema.extend({
  customization: z.object({
    direction: z.string().max(2_000),
    referenceGames: z.array(normalizedReferenceGameSchema).max(8),
    avoid: z.string().max(1_000),
  }).strict(),
}).strict();

export type GameArtStyleInput = z.input<typeof gameArtStyleInputSchema>;
export type GameArtStylePresetId = z.infer<typeof presetIdSchema>;
export type NormalizedGameArtStyleInput = z.output<typeof gameArtStyleInputSchema>;
export type GameArtStylePreviewAsset = z.infer<typeof gameArtStylePreviewAssetSchema>;
export type GameArtStylePreset = z.infer<typeof gameArtStylePresetSchema>;
export type GameArtStyleSnapshot = z.infer<typeof gameArtStyleSnapshotSchema>;
