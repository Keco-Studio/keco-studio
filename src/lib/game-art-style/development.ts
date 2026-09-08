import { z } from 'zod';
import { sha256CanonicalJson } from '@/lib/gdd-generation/resourceEvolution';
import { sanitizeAgentPolicyText } from '@/lib/game-design-system/agentPolicy';
import {
  gameArtStyleSnapshotSchema,
  type GameArtStyleSnapshot,
} from './schema';

const nullablePositiveInt = z.number().int().positive().max(16_384).nullable().optional();

export const gameArtProjectConstraintsSchema = z.object({
  camera: z.string().trim().min(1).max(200).nullable().optional(),
  tileSize: z.number().int().positive().max(1_024).nullable().optional(),
  pixelsPerUnit: z.number().positive().max(4_096).nullable().optional(),
  characterProportions: z.string().trim().min(1).max(300).nullable().optional(),
  palette: z.array(z.string().trim().min(1).max(32)).max(256).nullable().optional(),
  outlineWidth: z.number().nonnegative().max(64).nullable().optional(),
  outputWidth: nullablePositiveInt,
  outputHeight: nullablePositiveInt,
  transparent: z.boolean().nullable().optional(),
  animationFps: z.number().positive().max(240).nullable().optional(),
}).strict();

export type GameArtProjectConstraints = z.infer<typeof gameArtProjectConstraintsSchema>;

type ArtDirectionCategory = 'map' | 'character' | 'ui' | 'vfx' | 'animation';

export type CompiledGameArtDirection = {
  schemaVersion: 1;
  category: ArtDirectionCategory;
  snapshotHash: string;
  preset: { id: string; version: number; title: string };
  rendering: Record<string, string>;
  customization: GameArtStyleSnapshot['customization'];
  constraints: Required<GameArtProjectConstraints>;
};

const constraintKeys = [
  'camera',
  'tileSize',
  'pixelsPerUnit',
  'characterProportions',
  'palette',
  'outlineWidth',
  'outputWidth',
  'outputHeight',
  'transparent',
  'animationFps',
] as const;

function normalizedConstraints(value?: GameArtProjectConstraints): Required<GameArtProjectConstraints> {
  const parsed = gameArtProjectConstraintsSchema.parse(value ?? {});
  return Object.fromEntries(constraintKeys.map((key) => [key, parsed[key] ?? null])) as Required<GameArtProjectConstraints>;
}

function safeStyleText(value: string, max: number): string {
  return sanitizeAgentPolicyText(value, max);
}

function safeCustomization(value: GameArtStyleSnapshot['customization']): GameArtStyleSnapshot['customization'] {
  return {
    direction: safeStyleText(value.direction, 2_000),
    referenceGames: value.referenceGames.map((reference) => ({
      name: safeStyleText(reference.name, 120),
      borrow: safeStyleText(reference.borrow, 500),
    })),
    avoid: safeStyleText(value.avoid, 1_000),
  };
}

export function hashGameArtStyleSnapshot(snapshot: GameArtStyleSnapshot): string {
  return sha256CanonicalJson(gameArtStyleSnapshotSchema.parse(snapshot));
}

export function buildGddArtStyleContext(snapshot: GameArtStyleSnapshot): string {
  const parsed = gameArtStyleSnapshotSchema.parse(snapshot);
  return JSON.stringify({
    schemaVersion: parsed.schemaVersion,
    presetId: parsed.presetId,
    presetVersion: parsed.presetVersion,
    title: safeStyleText(parsed.title, 120),
    specification: Object.fromEntries(Object.entries(parsed.specification).map(([field, value]) => [field, safeStyleText(value, 2_000)])),
    customization: safeCustomization(parsed.customization),
    snapshotHash: hashGameArtStyleSnapshot(parsed),
    previewReferences: [
      parsed.previewAssetSet.map,
      parsed.previewAssetSet.character,
      ...parsed.previewAssetSet.supporting,
    ].map(({ publicPath, sha256, width, height }) => ({ publicPath, sha256, width, height, intendedRole: 'concept_only' as const })),
  });
}

function compile(
  category: ArtDirectionCategory,
  snapshot: GameArtStyleSnapshot,
  constraints: GameArtProjectConstraints | undefined,
  fields: Array<keyof GameArtStyleSnapshot['specification']>,
): CompiledGameArtDirection {
  const parsed = gameArtStyleSnapshotSchema.parse(snapshot);
  return {
    schemaVersion: 1,
    category,
    snapshotHash: hashGameArtStyleSnapshot(parsed),
    preset: { id: parsed.presetId, version: parsed.presetVersion, title: safeStyleText(parsed.title, 120) },
    rendering: Object.fromEntries(fields.map((field) => [field, safeStyleText(parsed.specification[field], 2_000)])),
    customization: safeCustomization(parsed.customization),
    constraints: normalizedConstraints(constraints),
  };
}

export function compileMapArtDirection(snapshot: GameArtStyleSnapshot, constraints?: GameArtProjectConstraints) {
  return compile('map', snapshot, constraints, ['visualIdentity', 'pixelTechnique', 'shapeLanguage', 'paletteAndLighting', 'environmentDirection', 'propDirection', 'effectsDirection', 'accessibility']);
}

export function compileCharacterArtDirection(snapshot: GameArtStyleSnapshot, constraints?: GameArtProjectConstraints) {
  return compile('character', snapshot, constraints, ['visualIdentity', 'pixelTechnique', 'shapeLanguage', 'paletteAndLighting', 'characterDirection', 'propDirection', 'accessibility']);
}

export function compileUiArtDirection(snapshot: GameArtStyleSnapshot, constraints?: GameArtProjectConstraints) {
  return compile('ui', snapshot, constraints, ['visualIdentity', 'pixelTechnique', 'shapeLanguage', 'paletteAndLighting', 'uiHudDirection', 'accessibility']);
}

export function compileVfxArtDirection(snapshot: GameArtStyleSnapshot, constraints?: GameArtProjectConstraints) {
  return compile('vfx', snapshot, constraints, ['visualIdentity', 'pixelTechnique', 'shapeLanguage', 'paletteAndLighting', 'effectsDirection', 'accessibility']);
}

export function compileAnimationArtDirection(snapshot: GameArtStyleSnapshot, constraints?: GameArtProjectConstraints) {
  return compile('animation', snapshot, constraints, ['visualIdentity', 'pixelTechnique', 'shapeLanguage', 'characterDirection', 'effectsDirection', 'animationDirection', 'accessibility']);
}
