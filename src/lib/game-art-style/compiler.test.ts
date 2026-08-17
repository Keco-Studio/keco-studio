import { describe, expect, it } from '@jest/globals';
import {
  gameArtStyleInputSchema,
  gameArtStyleSnapshotSchema,
  type GameArtStyleInput,
} from './schema';
import { compileGameArtStyle, normalizeGameArtStyleInput } from './compiler';
import { PIXEL_ART_V1_PRESET } from './presets';

const validInput = {
  presetId: 'pixel-art' as const,
  presetVersion: 1 as const,
  customization: {
    direction: 'Bright, readable exploration.',
    referenceGames: [{ name: 'Hyper Light Drifter', borrow: 'Readable silhouettes' }],
    avoid: 'No horror imagery.',
  },
};

const minimalInput: GameArtStyleInput = {
  presetId: 'pixel-art',
  presetVersion: 1,
  customization: { referenceGames: [] },
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
    expect(() => gameArtStyleInputSchema.parse({ ...validInput, presetId: 'painted' })).toThrow();
    expect(() => gameArtStyleInputSchema.parse({ ...validInput, presetVersion: 2 })).toThrow();
  });

  it('normalizes multiline text and visual references deterministically', () => {
    const normalized = normalizeGameArtStyleInput({
      presetId: 'pixel-art',
      presetVersion: 1,
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
      ...PIXEL_ART_V1_PRESET,
      customization: validInput.customization,
    });
    expect(() => gameArtStyleSnapshotSchema.parse(first)).not.toThrow();
    expect(JSON.stringify(first).length).toBeLessThanOrEqual(32 * 1024);
    expect(compileGameArtStyle(minimalInput).customization).toEqual({
      direction: '', referenceGames: [], avoid: '',
    });
  });

  it('deep-freezes the canonical registry against global mutation', () => {
    expect(Object.isFrozen(PIXEL_ART_V1_PRESET)).toBe(true);
    expect(Object.isFrozen(PIXEL_ART_V1_PRESET.specification)).toBe(true);
    expect(Object.isFrozen(PIXEL_ART_V1_PRESET.previewAssetSet.map)).toBe(true);
    expect(() => {
      (PIXEL_ART_V1_PRESET.specification as unknown as { visualIdentity: string }).visualIdentity = 'mutated';
    }).toThrow();
    expect(compileGameArtStyle(validInput).specification.visualIdentity).not.toBe('mutated');
  });

  it('enforces the compiled limit using UTF-8 bytes', () => {
    expect(() => compileGameArtStyle({
      presetId: 'pixel-art',
      presetVersion: 1,
      customization: {
        direction: '\u0000'.repeat(2_000),
        avoid: '\u0000'.repeat(1_000),
        referenceGames: Array.from({ length: 8 }, (_, index) => ({
          name: `Game ${index}`,
          borrow: '\u0000'.repeat(500),
        })),
      },
    })).toThrow(/32 KiB/);
  });
});
