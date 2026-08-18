import pixelArtV1Fixture from '../../../docs/superpowers/specs/game-art-styles/pixel-art/v1/preset.json';
import pixelArtV2Fixture from '../../../docs/superpowers/specs/game-art-styles/pixel-art/v2/preset.json';
import flatGraphic2dV1Fixture from '../../../docs/superpowers/specs/game-art-styles/flat-graphic-2d/v1/preset.json';
import handPainted2dV1Fixture from '../../../docs/superpowers/specs/game-art-styles/hand-painted-2d/v1/preset.json';
import celShaded3dV1Fixture from '../../../docs/superpowers/specs/game-art-styles/cel-shaded-3d/v1/preset.json';
import lowPoly3dV1Fixture from '../../../docs/superpowers/specs/game-art-styles/low-poly-3d/v1/preset.json';
import { gameArtStylePresetSchema, gameArtStyleSnapshotSchema, type GameArtStylePreset, type GameArtStylePresetId, type GameArtStyleSnapshot } from './schema';

type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}

export const PIXEL_ART_V1_PRESET: DeepReadonly<GameArtStylePreset> = deepFreeze(
  gameArtStylePresetSchema.parse(pixelArtV1Fixture),
);
export const PIXEL_ART_V2_PRESET = deepFreeze(gameArtStylePresetSchema.parse(pixelArtV2Fixture));
export const FLAT_GRAPHIC_2D_V1_PRESET = deepFreeze(gameArtStylePresetSchema.parse(flatGraphic2dV1Fixture));
export const HAND_PAINTED_2D_V1_PRESET = deepFreeze(gameArtStylePresetSchema.parse(handPainted2dV1Fixture));
export const CEL_SHADED_3D_V1_PRESET = deepFreeze(gameArtStylePresetSchema.parse(celShaded3dV1Fixture));
export const LOW_POLY_3D_V1_PRESET = deepFreeze(gameArtStylePresetSchema.parse(lowPoly3dV1Fixture));

export function gameArtStyleKey(id: GameArtStylePresetId, version: number): string {
  return `${id}@${version}`;
}

const retainedPresets = [
  PIXEL_ART_V1_PRESET,
  PIXEL_ART_V2_PRESET,
  FLAT_GRAPHIC_2D_V1_PRESET,
  HAND_PAINTED_2D_V1_PRESET,
  CEL_SHADED_3D_V1_PRESET,
  LOW_POLY_3D_V1_PRESET,
] as const;
const entries = retainedPresets.map((preset) => [gameArtStyleKey(preset.presetId, preset.presetVersion), preset] as const);
if (new Set(entries.map(([key]) => key)).size !== entries.length) throw new Error('Duplicate Game Art Style compound key.');

export const GAME_ART_STYLE_PRESETS_BY_KEY: Readonly<Record<string, DeepReadonly<GameArtStylePreset>>> = deepFreeze(Object.fromEntries(entries));
export const GAME_ART_STYLE_CATALOG = deepFreeze([
  PIXEL_ART_V2_PRESET,
  FLAT_GRAPHIC_2D_V1_PRESET,
  HAND_PAINTED_2D_V1_PRESET,
  CEL_SHADED_3D_V1_PRESET,
  LOW_POLY_3D_V1_PRESET,
] as const);
export const RETIRED_GAME_ART_STYLE_KEYS = deepFreeze(['pixel-art@1']);
export const DEFAULT_GAME_ART_STYLE_KEY = 'pixel-art@2';

export function resolveGameArtStylePreset(id: GameArtStylePresetId, version: number): DeepReadonly<GameArtStylePreset> {
  const preset = GAME_ART_STYLE_PRESETS_BY_KEY[gameArtStyleKey(id, version)];
  if (!preset) throw new Error(`Unknown Game Art Style: ${gameArtStyleKey(id, version)}`);
  return preset;
}

export function resolveOfferedGameArtStylePreset(id: GameArtStylePresetId, version: number): DeepReadonly<GameArtStylePreset> {
  const key = gameArtStyleKey(id, version);
  const preset = GAME_ART_STYLE_CATALOG.find((candidate) => gameArtStyleKey(candidate.presetId, candidate.presetVersion) === key);
  if (!preset) throw new Error(`Unknown or retired Game Art Style: ${key}`);
  return preset;
}

export function parseRetainedGameArtStyleSnapshot(raw: unknown): GameArtStyleSnapshot {
  const snapshot = gameArtStyleSnapshotSchema.parse(raw);
  resolveGameArtStylePreset(snapshot.presetId, snapshot.presetVersion);
  return snapshot;
}
