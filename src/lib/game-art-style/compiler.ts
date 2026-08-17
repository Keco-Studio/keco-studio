import {
  GAME_ART_STYLE_MAX_BYTES,
  gameArtStyleInputSchema,
  gameArtStyleSnapshotSchema,
  type NormalizedGameArtStyleInput,
  type GameArtStyleSnapshot,
} from './schema';
import { PIXEL_ART_V1_PRESET } from './presets';

export class GameArtStyleCompilationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GameArtStyleCompilationError';
  }
}

export function normalizeGameArtStyleInput(value: unknown): NormalizedGameArtStyleInput {
  return gameArtStyleInputSchema.parse(value);
}

export function compileGameArtStyle(value: unknown): GameArtStyleSnapshot {
  const input = normalizeGameArtStyleInput(value);
  const snapshot = gameArtStyleSnapshotSchema.parse({
    ...PIXEL_ART_V1_PRESET,
    previewAssetSet: {
      ...PIXEL_ART_V1_PRESET.previewAssetSet,
      map: { ...PIXEL_ART_V1_PRESET.previewAssetSet.map },
      character: { ...PIXEL_ART_V1_PRESET.previewAssetSet.character },
      supporting: PIXEL_ART_V1_PRESET.previewAssetSet.supporting.map((asset) => ({ ...asset })),
    },
    specification: { ...PIXEL_ART_V1_PRESET.specification },
    customization: input.customization,
  });
  const bytes = new TextEncoder().encode(JSON.stringify(snapshot)).byteLength;
  if (bytes > GAME_ART_STYLE_MAX_BYTES) {
    throw new GameArtStyleCompilationError(`Game Art Style snapshot exceeds the 32 KiB limit (${bytes} bytes).`);
  }
  return snapshot;
}
