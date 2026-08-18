import { describe, expect, it } from '@jest/globals';
import { gameDesignGenerationRequestSchema } from './generationRequest';

const artStyle = {
  presetId: 'pixel-art',
  presetVersion: 2,
  customization: {
    direction: '  Bright routes.  ',
    referenceGames: [{ name: ' Eastward ', borrow: ' Material clusters ' }],
    avoid: '',
  },
};

const valid = {
  title: 'Readable exploration',
  genres: ['RPG'],
  philosophies: [],
  references: [],
  referenceGames: [{ name: 'Into the Breach', reference: 'Readable intent', avoid: 'Direct copying' }],
  artStyle,
};

describe('Game Design System generation request', () => {
  it('requires and normalizes a strict Art Style selector payload', () => {
    expect(gameDesignGenerationRequestSchema.parse(valid).artStyle.customization).toEqual({
      direction: 'Bright routes.',
      referenceGames: [{ name: 'Eastward', borrow: 'Material clusters' }],
      avoid: '',
    });
    expect(() => gameDesignGenerationRequestSchema.parse({ ...valid, artStyle: undefined })).toThrow();
    expect(() => gameDesignGenerationRequestSchema.parse({ ...valid, unknown: true })).toThrow();
    expect(() => gameDesignGenerationRequestSchema.parse({
      ...valid,
      artStyle: { ...artStyle, specification: { visualIdentity: 'forged' } },
    })).toThrow();
  });

  it('keeps visual references separate from gameplay references', () => {
    const parsed = gameDesignGenerationRequestSchema.parse(valid);
    expect(parsed.referenceGames).toEqual(valid.referenceGames);
    expect(parsed.artStyle.customization.referenceGames).toEqual([
      { name: 'Eastward', borrow: 'Material clusters' },
    ]);
  });
});
