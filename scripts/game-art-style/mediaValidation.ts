import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const MAX_PUBLISHED_BYTES = 12 * 1024 * 1024;

export type ValidatedImage = {
  width: number;
  height: number;
  bytes: number;
  sha256: string;
  alpha: 'opaque' | 'transparent';
};

export async function normalizeAndValidatePng(
  input: Buffer,
  target: string,
): Promise<ValidatedImage> {
  await mkdir(path.dirname(target), { recursive: true });
  const normalized = await sharp(input, { failOn: 'error', limitInputPixels: 40_000_000 })
    .rotate()
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
  if (!normalized.length || normalized.length > MAX_PUBLISHED_BYTES) {
    throw new Error('Generated image byte size is invalid.');
  }
  const image = sharp(normalized, { failOn: 'error' });
  const [metadata, stats, pixels] = await Promise.all([
    image.metadata(),
    image.stats(),
    image.ensureAlpha().raw().toBuffer(),
  ]);
  if (metadata.format !== 'png' || !metadata.width || !metadata.height || metadata.width < 256 || metadata.height < 256) {
    throw new Error('Generated image dimensions or format are invalid.');
  }
  if (!pixels.some((value, index) => index % 4 === 3 && value > 0)) {
    throw new Error('Generated image has no visible pixels.');
  }
  await writeFile(target, normalized);
  return {
    width: metadata.width,
    height: metadata.height,
    bytes: normalized.length,
    sha256: createHash('sha256').update(normalized).digest('hex'),
    alpha: stats.isOpaque ? 'opaque' : 'transparent',
  };
}

export async function inspectPng(file: string): Promise<ValidatedImage> {
  const bytes = await readFile(file);
  const image = sharp(bytes, { failOn: 'error' });
  const [metadata, stats, pixels] = await Promise.all([
    image.metadata(),
    image.stats(),
    image.ensureAlpha().raw().toBuffer(),
  ]);
  if (metadata.format !== 'png' || !metadata.width || !metadata.height || !pixels.some((value, index) => index % 4 === 3 && value > 0)) {
    throw new Error(`Invalid PNG: ${path.basename(file)}`);
  }
  return {
    width: metadata.width,
    height: metadata.height,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    alpha: stats.isOpaque ? 'opaque' : 'transparent',
  };
}
