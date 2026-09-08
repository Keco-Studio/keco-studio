import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { visualOutputObservationSchema } from './outputValidation';

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_PIXELS = 16_777_216;

function bucket(value: number): number {
  return Math.min(15, Math.floor(value / 16));
}

export async function inspectVisualOutput(bytes: Uint8Array) {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) throw new Error('Image input must be between 1 byte and 10 MiB.');
  const image = sharp(bytes, { failOn: 'error', limitInputPixels: MAX_PIXELS });
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height || !metadata.format) throw new Error('Image metadata is incomplete.');
  if (!['png', 'jpeg', 'webp', 'gif', 'avif'].includes(metadata.format)) throw new Error('Image format is unsupported.');
  const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let visible = 0;
  let transparent = 0;
  let semitransparent = 0;
  let edges = 0;
  let comparisons = 0;
  let equalNeighbors = 0;
  const colors = new Set<number>();
  const pixel = (x: number, y: number, channel: number) => data[(y * info.width + x) * 4 + channel];
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const alpha = pixel(x, y, 3);
      if (alpha < 255) transparent += 1;
      if (alpha > 0) {
        visible += 1;
        colors.add((bucket(pixel(x, y, 0)) << 12) | (bucket(pixel(x, y, 1)) << 8) | (bucket(pixel(x, y, 2)) << 4) | bucket(alpha));
      }
      if (alpha > 0 && alpha < 255) semitransparent += 1;
      if (x > 0) {
        comparisons += 1;
        const difference = Math.abs(pixel(x, y, 0) - pixel(x - 1, y, 0)) + Math.abs(pixel(x, y, 1) - pixel(x - 1, y, 1)) + Math.abs(pixel(x, y, 2) - pixel(x - 1, y, 2));
        if (difference >= 96) edges += 1;
        if (difference === 0 && alpha === pixel(x - 1, y, 3)) equalNeighbors += 1;
      }
      if (y > 0) {
        comparisons += 1;
        const difference = Math.abs(pixel(x, y, 0) - pixel(x, y - 1, 0)) + Math.abs(pixel(x, y, 1) - pixel(x, y - 1, 1)) + Math.abs(pixel(x, y, 2) - pixel(x, y - 1, 2));
        if (difference >= 96) edges += 1;
        if (difference === 0 && alpha === pixel(x, y - 1, 3)) equalNeighbors += 1;
      }
    }
  }
  return visualOutputObservationSchema.parse({
    schemaVersion: 1,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    format: metadata.format,
    width: info.width,
    height: info.height,
    hasAlpha: transparent > 0,
    visiblePixels: visible,
    approximatePaletteCardinality: colors.size,
    semitransparentPixelRatio: visible === 0 ? 0 : semitransparent / visible,
    edgeDensity: comparisons === 0 ? 0 : edges / comparisons,
    nearestNeighborBlockConsistency: comparisons === 0 ? null : equalNeighbors / comparisons,
  });
}
