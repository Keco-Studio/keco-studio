import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from '@jest/globals';
import sharp from 'sharp';
import preset from '../../docs/superpowers/specs/2026-08-17-pixel-art-v1-preset.json';
import manifest from '../../docs/superpowers/specs/2026-08-17-pixel-art-v1-asset-manifest.json';

describe('Pixel Art v1 release assets', () => {
  const assets = [
    ['map', preset.previewAssetSet.map],
    ['character', preset.previewAssetSet.character],
    ...preset.previewAssetSet.supporting.map((asset, index) => [`supporting-${index}`, asset] as const),
  ] as const;

  it.each(assets)('matches canonical metadata for %s', async (_name, asset) => {
    const source = join(process.cwd(), asset.sourcePath);
    const bytes = await readFile(source);
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
  });

  it('keeps provenance separate from the runtime preset and hashes submitted prompts', () => {
    expect(manifest.manifestPurpose).toContain('never a runtime registry input');
    expect(manifest.validation.requireVisiblePixels).toBe(true);
    expect(manifest.runtimeSource).toBe('docs/superpowers/specs/2026-08-17-pixel-art-v1-preset.json');
    for (const asset of manifest.assets) {
      expect(createHash('sha256').update(asset.submittedPrompt).digest('hex')).toBe(asset.submittedPromptSha256);
      expect(asset.providerMode).toBe('pro');
      expect(asset.providerResultId).toMatch(/^[0-9a-f-]{36}$/);
      expect(asset.review.status).toBe('approved');
    }
  });
});
