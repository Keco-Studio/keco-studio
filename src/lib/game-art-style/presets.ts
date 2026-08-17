import pixelArtV1Fixture from '../../../docs/superpowers/specs/2026-08-17-pixel-art-v1-preset.json';
import { gameArtStylePresetSchema, type GameArtStylePreset } from './schema';

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

export const GAME_ART_STYLE_CATALOG = deepFreeze([PIXEL_ART_V1_PRESET] as const);
