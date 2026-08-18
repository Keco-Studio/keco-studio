import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from '@jest/globals';
import sharp from 'sharp';
import pixelV1Preset from '../../docs/superpowers/specs/game-art-styles/pixel-art/v1/preset.json';
import pixelV1Manifest from '../../docs/superpowers/specs/game-art-styles/pixel-art/v1/asset-manifest.json';
import pixelV2Preset from '../../docs/superpowers/specs/game-art-styles/pixel-art/v2/preset.json';
import pixelV2Manifest from '../../docs/superpowers/specs/game-art-styles/pixel-art/v2/asset-manifest.json';
import flatPreset from '../../docs/superpowers/specs/game-art-styles/flat-graphic-2d/v1/preset.json';
import flatManifest from '../../docs/superpowers/specs/game-art-styles/flat-graphic-2d/v1/asset-manifest.json';
import paintedPreset from '../../docs/superpowers/specs/game-art-styles/hand-painted-2d/v1/preset.json';
import paintedManifest from '../../docs/superpowers/specs/game-art-styles/hand-painted-2d/v1/asset-manifest.json';
import celPreset from '../../docs/superpowers/specs/game-art-styles/cel-shaded-3d/v1/preset.json';
import celManifest from '../../docs/superpowers/specs/game-art-styles/cel-shaded-3d/v1/asset-manifest.json';
import lowPolyPreset from '../../docs/superpowers/specs/game-art-styles/low-poly-3d/v1/preset.json';
import lowPolyManifest from '../../docs/superpowers/specs/game-art-styles/low-poly-3d/v1/asset-manifest.json';

const releases = [
  { key: 'pixel-art@1', preset: pixelV1Preset, manifest: pixelV1Manifest, legacy: true },
  { key: 'pixel-art@2', preset: pixelV2Preset, manifest: pixelV2Manifest, legacy: false },
  { key: 'flat-graphic-2d@1', preset: flatPreset, manifest: flatManifest, legacy: false },
  { key: 'hand-painted-2d@1', preset: paintedPreset, manifest: paintedManifest, legacy: false },
  { key: 'cel-shaded-3d@1', preset: celPreset, manifest: celManifest, legacy: false },
  { key: 'low-poly-3d@1', preset: lowPolyPreset, manifest: lowPolyManifest, legacy: false },
] as const;

describe('Game Art Style release assets', () => {
  it.each(releases)('matches canonical public metadata for $key', async ({ preset }) => {
    const assets = [preset.previewAssetSet.map, preset.previewAssetSet.character, ...preset.previewAssetSet.supporting];
    for (const asset of assets) {
      const bytes = await readFile(join(process.cwd(), asset.sourcePath));
      const metadata = await sharp(bytes).metadata();
      const stats = await sharp(bytes).stats();
      expect(asset.sourcePath).toMatch(/^public\/game-art-styles\//);
      expect(asset.publicPath).toMatch(/^\/game-art-styles\//);
      expect(metadata.format).toBe('png');
      expect(metadata.width).toBe(asset.width);
      expect(metadata.height).toBe(asset.height);
      expect(bytes.byteLength).toBe(asset.bytes);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(asset.sha256);
      expect(stats.isOpaque ? 'opaque' : 'transparent').toBe(asset.alpha);
      const pixels = await sharp(bytes).ensureAlpha().raw().toBuffer();
      expect(Array.from(pixels).some((_channel, index) => index % 4 === 3 && pixels[index] > 0)).toBe(true);
    }
  });

  it('keeps all final map and character images distinct', () => {
    const hashes = releases.flatMap(({ preset }) => [preset.previewAssetSet.map.sha256, preset.previewAssetSet.character.sha256]);
    expect(new Set(hashes).size).toBe(hashes.length);
  });

  it.each(releases.filter(({ legacy }) => !legacy))('records approved, redacted provenance for $key', ({ key, preset, manifest }) => {
    expect(manifest.manifestPurpose).toContain('never a runtime registry input');
    expect(manifest.releaseKey).toBe(key);
    expect(manifest.validation.requireVisiblePixels).toBe(true);
    expect(manifest.review.reviewers).toHaveLength(2);
    expect(Object.values(manifest.review.rubrics).every((result) => result === 'pass')).toBe(true);
    expect(manifest.assets.map((asset) => asset.sha256)).toEqual([
      preset.previewAssetSet.map.sha256,
      preset.previewAssetSet.character.sha256,
    ]);
    for (const asset of manifest.assets) {
      expect(createHash('sha256').update(asset.submittedPrompt).digest('hex')).toBe(asset.submittedPromptSha256);
      expect(asset.endpointHash).toMatch(/^[0-9a-f]{64}$/);
      expect(asset).not.toHaveProperty('apiKey');
      expect(asset).not.toHaveProperty('authorization');
    }
  });

  it('preserves the historical Pixel Art v1 provenance contract', () => {
    expect(pixelV1Manifest.manifestPurpose).toContain('never a runtime registry input');
    expect(pixelV1Manifest.runtimeSource).toBe('docs/superpowers/specs/game-art-styles/pixel-art/v1/preset.json');
    for (const asset of pixelV1Manifest.assets) {
      expect(createHash('sha256').update(asset.submittedPrompt).digest('hex')).toBe(asset.submittedPromptSha256);
      expect(asset.review.status).toBe('approved');
    }
  });
});
