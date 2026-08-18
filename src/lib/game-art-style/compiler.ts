import {
  GAME_ART_STYLE_MAX_BYTES,
  gameArtStyleInputSchema,
  gameArtStyleSnapshotSchema,
  type NormalizedGameArtStyleInput,
  type GameArtStyleSnapshot,
} from './schema';
import { resolveOfferedGameArtStylePreset } from './presets';

export class GameArtStyleCompilationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GameArtStyleCompilationError';
  }
}

const utf8Encoder = new TextEncoder();

function postgresJsonbStringBytes(value: string): number {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit === 0) {
      throw new GameArtStyleCompilationError('Game Art Style text contains NUL, which PostgreSQL jsonb cannot store.');
    }
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const trailing = value.charCodeAt(index + 1);
      if (!Number.isInteger(trailing) || trailing < 0xdc00 || trailing > 0xdfff) {
        throw new GameArtStyleCompilationError('Game Art Style text contains an unpaired surrogate, which PostgreSQL jsonb cannot store.');
      }
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      throw new GameArtStyleCompilationError('Game Art Style text contains an unpaired surrogate, which PostgreSQL jsonb cannot store.');
    }
  }

  return utf8Encoder.encode(JSON.stringify(value)).byteLength;
}

function postgresJsonbTextBytes(value: unknown): number {
  if (value === null) return 4;
  if (typeof value === 'string') return postgresJsonbStringBytes(value);
  if (typeof value === 'boolean') return value ? 4 : 5;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new GameArtStyleCompilationError('Game Art Style contains a number that cannot be represented as a safe PostgreSQL jsonb integer.');
    }
    return utf8Encoder.encode(JSON.stringify(value)).byteLength;
  }
  if (Array.isArray(value)) {
    return 2
      + value.reduce((bytes, item) => bytes + postgresJsonbTextBytes(item), 0)
      + Math.max(0, value.length - 1) * 2;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value);
    return 2
      + entries.reduce((bytes, [key, item]) => (
        bytes + postgresJsonbStringBytes(key) + 2 + postgresJsonbTextBytes(item)
      ), 0)
      + Math.max(0, entries.length - 1) * 2;
  }
  throw new GameArtStyleCompilationError('Game Art Style contains a value that PostgreSQL jsonb cannot store.');
}

export function normalizeGameArtStyleInput(value: unknown): NormalizedGameArtStyleInput {
  return gameArtStyleInputSchema.parse(value);
}

export function compileGameArtStyle(value: unknown): GameArtStyleSnapshot {
  const input = normalizeGameArtStyleInput(value);
  let preset;
  try {
    preset = resolveOfferedGameArtStylePreset(input.presetId, input.presetVersion);
  } catch (error) {
    throw new GameArtStyleCompilationError(error instanceof Error ? error.message : 'Unknown Game Art Style.');
  }
  const snapshot = gameArtStyleSnapshotSchema.parse({
    ...preset,
    previewAssetSet: {
      ...preset.previewAssetSet,
      map: { ...preset.previewAssetSet.map },
      character: { ...preset.previewAssetSet.character },
      supporting: preset.previewAssetSet.supporting.map((asset) => ({ ...asset })),
    },
    specification: { ...preset.specification },
    customization: input.customization,
  });
  const bytes = postgresJsonbTextBytes(snapshot);
  if (bytes > GAME_ART_STYLE_MAX_BYTES) {
    throw new GameArtStyleCompilationError(`Game Art Style snapshot exceeds the 32 KiB limit (${bytes} bytes).`);
  }
  return snapshot;
}
