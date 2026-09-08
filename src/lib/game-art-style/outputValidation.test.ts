import sharp from 'sharp';
import { compileGameArtStyle } from './compiler';
import { compileCharacterArtDirection } from './development';
import { inspectVisualOutput } from './outputInspector';
import { evaluateVisualOutput } from './outputValidation';

describe('visual output observation', () => {
  it('inspects authoritative pixels and keeps semantic style review blocked', async () => {
    const bytes = await sharp({ create: { width: 32, height: 32, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    const observation = await inspectVisualOutput(bytes);
    expect(observation).toMatchObject({ format: 'png', width: 32, height: 32, hasAlpha: true });
    expect(observation.approximatePaletteCardinality).toBe(0);
    const direction = compileCharacterArtDirection(compileGameArtStyle({ presetId: 'pixel-art', presetVersion: 2, customization: { referenceGames: [] } }), { outputWidth: 32, outputHeight: 32, transparent: true });
    const result = evaluateVisualOutput(observation, direction, { observedStyleHash: direction.snapshotHash });
    expect(result.provenanceStatus).toBe('pass');
    expect(result.visualStyleStatus).toBe('blocked');
  });

  it('requires every category-specific semantic criterion before visual style can pass', async () => {
    const bytes = await sharp({ create: { width: 32, height: 32, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } }).png().toBuffer();
    const observation = await inspectVisualOutput(bytes);
    const direction = compileCharacterArtDirection(compileGameArtStyle({ presetId: 'pixel-art', presetVersion: 2, customization: { referenceGames: [] } }));
    const result = evaluateVisualOutput(observation, direction, {
      observedStyleHash: direction.snapshotHash,
      visualReview: {
        reviewer: 'reviewer-1',
        reviewedAt: '2026-09-08T00:00:00.000Z',
        assertions: [{ criterion: 'silhouette', status: 'pass', evidence: 'The silhouette is readable at native size.' }],
      },
    });
    expect(result.visualStyleStatus).toBe('blocked');
    expect(result.assertions).toEqual(expect.arrayContaining([
      expect.objectContaining({ criterion: 'semantic_palette', status: 'blocked' }),
      expect.objectContaining({ criterion: 'subject_matter', status: 'blocked' }),
      expect.objectContaining({ criterion: 'outline_behavior', status: 'blocked' }),
    ]));
  });

  it('does not treat an opaque RGBA channel as actual transparency', async () => {
    const bytes = await sharp({ create: { width: 16, height: 16, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } }).png().toBuffer();
    const observation = await inspectVisualOutput(bytes);
    const direction = compileCharacterArtDirection(
      compileGameArtStyle({ presetId: 'pixel-art', presetVersion: 2, customization: { referenceGames: [] } }),
      { transparent: true },
    );
    expect(observation.hasAlpha).toBe(false);
    expect(evaluateVisualOutput(observation, direction).visualStyleStatus).toBe('fail');
  });
});
