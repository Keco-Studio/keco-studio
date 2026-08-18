import { describe, expect, it } from '@jest/globals';
import {
  gameArtStyleInputSchema,
  gameArtStyleSnapshotSchema,
  type GameArtStyleInput,
} from './schema';
import {
  compileGameArtStyle,
  GameArtStyleCompilationError,
  normalizeGameArtStyleInput,
} from './compiler';
import { PIXEL_ART_V2_PRESET } from './presets';

const validInput = {
  presetId: 'pixel-art' as const,
  presetVersion: 2 as const,
  customization: {
    direction: 'Bright, readable exploration.',
    referenceGames: [{ name: 'Hyper Light Drifter', borrow: 'Readable silhouettes' }],
    avoid: 'No horror imagery.',
  },
};

const minimalInput: GameArtStyleInput = {
  presetId: 'pixel-art',
  presetVersion: 2,
  customization: { referenceGames: [] },
};

const storageBoundaryInput: GameArtStyleInput = {
  presetId: 'pixel-art',
  presetVersion: 2,
  customization: {
    direction: '\u0001'.repeat(2_000),
    avoid: '\u0001'.repeat(1_000),
    referenceGames: ['aa', 'bb', 'cc', 'dd', 'ee', 'ff', 'gg', 'hh'].map((name, index) => ({
      name,
      borrow: index < 7 ? '\u0001'.repeat(500) : `${'\u0001'.repeat(499)}x`,
    })),
  },
};

describe('Game Art Style compiler', () => {
  it('strictly rejects unknown and client-compiled fields at every level', () => {
    expect(() => gameArtStyleInputSchema.parse({ ...validInput, specification: {} })).toThrow();
    expect(() => gameArtStyleInputSchema.parse({
      ...validInput,
      customization: { ...validInput.customization, previewAssetSet: {} },
    })).toThrow();
    expect(() => gameArtStyleInputSchema.parse({
      ...validInput,
      customization: { ...validInput.customization, referenceGames: [{ name: 'Game', borrow: 'Color', extra: true }] },
    })).toThrow();
    expect(() => compileGameArtStyle({ ...validInput, presetId: 'painted' })).toThrow(/Unknown.*Game Art Style/);
    expect(() => compileGameArtStyle({ ...validInput, presetVersion: 999 })).toThrow(/Unknown.*Game Art Style/);
    expect(() => compileGameArtStyle({ ...validInput, presetVersion: 1 })).toThrow(/retired|unknown/i);
  });

  it('normalizes multiline text and visual references deterministically', () => {
    const normalized = normalizeGameArtStyleInput({
      presetId: 'pixel-art',
      presetVersion: 2,
      customization: {
        direction: '  Bright sky  \r\nSoft water\t \r\n  ',
        referenceGames: [
          { name: ' Hyper Light Drifter ', borrow: ' Readable silhouettes ' },
          { name: '', borrow: '  ' },
          { name: 'hyper light drifter', borrow: 'Ignore this duplicate' },
          { name: 'Eastward', borrow: ' Material clusters ' },
        ],
        avoid: '  No horror.  \r\nNo generated text.   ',
      },
    });

    expect(normalized.customization).toEqual({
      direction: 'Bright sky\nSoft water',
      referenceGames: [
        { name: 'Hyper Light Drifter', borrow: 'Readable silhouettes' },
        { name: 'Eastward', borrow: 'Material clusters' },
      ],
      avoid: 'No horror.\nNo generated text.',
    });
  });

  it('rejects half-filled references and configured limits', () => {
    expect(() => normalizeGameArtStyleInput({
      ...validInput,
      customization: { ...validInput.customization, referenceGames: [{ name: 'Eastward', borrow: '' }] },
    })).toThrow(/borrow/i);
    expect(() => normalizeGameArtStyleInput({
      ...validInput,
      customization: { ...validInput.customization, direction: 'x'.repeat(2_001) },
    })).toThrow();
    expect(() => normalizeGameArtStyleInput({
      ...validInput,
      customization: {
        ...validInput.customization,
        referenceGames: Array.from({ length: 9 }, (_, index) => ({ name: `Game ${index}`, borrow: 'Palette' })),
      },
    })).toThrow();
  });

  it('compiles an immutable complete snapshot from the canonical preset', () => {
    const first = compileGameArtStyle(validInput);
    const second = compileGameArtStyle(validInput);

    expect(first).toEqual(second);
    expect(first).toEqual({
      ...PIXEL_ART_V2_PRESET,
      customization: validInput.customization,
    });
    expect(() => gameArtStyleSnapshotSchema.parse(first)).not.toThrow();
    expect(JSON.stringify(first).length).toBeLessThanOrEqual(32 * 1024);
    expect(compileGameArtStyle(minimalInput).customization).toEqual({
      direction: '', referenceGames: [], avoid: '',
    });
  });

  it('deep-freezes the canonical registry against global mutation', () => {
    expect(Object.isFrozen(PIXEL_ART_V2_PRESET)).toBe(true);
    expect(Object.isFrozen(PIXEL_ART_V2_PRESET.specification)).toBe(true);
    expect(Object.isFrozen(PIXEL_ART_V2_PRESET.previewAssetSet.map)).toBe(true);
    expect(() => {
      (PIXEL_ART_V2_PRESET.specification as unknown as { visualIdentity: string }).visualIdentity = 'mutated';
    }).toThrow();
    expect(compileGameArtStyle(validInput).specification.visualIdentity).not.toBe('mutated');
  });

  it('rejects a snapshot that fits compact JSON but exceeds PostgreSQL jsonb text storage', () => {
    const compactSnapshot = gameArtStyleSnapshotSchema.parse({
      ...PIXEL_ART_V2_PRESET,
      customization: storageBoundaryInput.customization,
    });

    expect(new TextEncoder().encode(JSON.stringify(compactSnapshot)).length).toBeGreaterThan(30_000);
    expect(() => compileGameArtStyle(storageBoundaryInput)).toThrow(GameArtStyleCompilationError);
    expect(() => compileGameArtStyle(storageBoundaryInput)).toThrow(/32 KiB limit/);
  });

  it.each([
    ['NUL', '\u0000'],
    ['unpaired high surrogate', '\ud800'],
    ['unpaired low surrogate', '\udc00'],
  ])('rejects %s text that PostgreSQL jsonb cannot safely store', (_label, direction) => {
    expect(() => compileGameArtStyle({
      ...minimalInput,
      customization: { direction, referenceGames: [] },
    })).toThrow(GameArtStyleCompilationError);
    expect(() => compileGameArtStyle({
      ...minimalInput,
      customization: { direction, referenceGames: [] },
    })).toThrow(/PostgreSQL jsonb/i);
  });

  it('accepts valid non-BMP text represented by a surrogate pair', () => {
    expect(compileGameArtStyle({
      ...minimalInput,
      customization: { direction: '\ud83c\udfa8', referenceGames: [] },
    }).customization.direction).toBe('\ud83c\udfa8');
  });
});
