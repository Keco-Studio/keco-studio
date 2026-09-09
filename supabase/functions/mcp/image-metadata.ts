import { decode } from 'fast-png';

export type ImageFileType =
  | 'image/png'
  | 'image/jpeg'
  | 'image/gif'
  | 'image/webp'
  | 'image/svg+xml';

export type VerifiedImageMetadata = {
  sha256: string;
  width: number | null;
  height: number | null;
  hasTransparency: boolean | null;
};

type ImageDimensions = Omit<VerifiedImageMetadata, 'sha256'>;

const EMPTY_DIMENSIONS: ImageDimensions = {
  width: null,
  height: null,
  hasTransparency: null,
};
const MAX_SVG_BYTES = 5 * 1024 * 1024;

export async function inspectVerifiedImage(
  fileType: ImageFileType,
  bytes: Uint8Array,
): Promise<VerifiedImageMetadata> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer);
  const sha256 = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0')).join('');
  const dimensions = fileType === 'image/png' ? inspectPng(bytes)
    : fileType === 'image/jpeg' ? inspectJpeg(bytes)
    : fileType === 'image/gif' ? inspectGif(bytes)
    : fileType === 'image/webp' ? inspectWebp(bytes)
    : inspectSvg(bytes);
  return { sha256, ...dimensions };
}

function inspectPng(bytes: Uint8Array): ImageDimensions {
  try {
    const decoded = decode(bytes);
    if (!isPositiveDimension(decoded.width) || !isPositiveDimension(decoded.height)) {
      return EMPTY_DIMENSIONS;
    }
    if (decoded.channels !== 2 && decoded.channels !== 4) {
      return { width: decoded.width, height: decoded.height, hasTransparency: false };
    }

    const opaqueAlpha = decoded.depth === 16 ? 65535 : 255;
    for (let index = decoded.channels - 1; index < decoded.data.length; index += decoded.channels) {
      if (decoded.data[index] !== opaqueAlpha) {
        return { width: decoded.width, height: decoded.height, hasTransparency: true };
      }
    }
    return { width: decoded.width, height: decoded.height, hasTransparency: false };
  } catch {
    return EMPTY_DIMENSIONS;
  }
}

function inspectJpeg(bytes: Uint8Array): ImageDimensions {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return EMPTY_DIMENSIONS;

  let offset = 2;
  while (offset + 1 < bytes.length) {
    while (offset < bytes.length && bytes[offset] === 0xff) offset++;
    if (offset >= bytes.length) return EMPTY_DIMENSIONS;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda) return EMPTY_DIMENSIONS;
    if (marker === 0x00 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 1 >= bytes.length) return EMPTY_DIMENSIONS;

    const length = readUint16BE(bytes, offset);
    if (length < 2 || offset + length > bytes.length) return EMPTY_DIMENSIONS;
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      if (length < 8) return EMPTY_DIMENSIONS;
      const height = readUint16BE(bytes, offset + 3);
      const width = readUint16BE(bytes, offset + 5);
      return isPositiveDimension(width) && isPositiveDimension(height)
        ? { width, height, hasTransparency: false }
        : EMPTY_DIMENSIONS;
    }
    offset += length;
  }
  return EMPTY_DIMENSIONS;
}

function inspectGif(bytes: Uint8Array): ImageDimensions {
  if (
    bytes.length < 10
    || bytes[0] !== 0x47 || bytes[1] !== 0x49 || bytes[2] !== 0x46
    || bytes[3] !== 0x38 || (bytes[4] !== 0x37 && bytes[4] !== 0x39) || bytes[5] !== 0x61
  ) return EMPTY_DIMENSIONS;

  const width = readUint16LE(bytes, 6);
  const height = readUint16LE(bytes, 8);
  return isPositiveDimension(width) && isPositiveDimension(height)
    ? { width, height, hasTransparency: null }
    : EMPTY_DIMENSIONS;
}

function inspectWebp(bytes: Uint8Array): ImageDimensions {
  if (
    bytes.length < 20
    || !matchesAscii(bytes, 0, 'RIFF')
    || !matchesAscii(bytes, 8, 'WEBP')
  ) return EMPTY_DIMENSIONS;

  const declaredSize = readUint32LE(bytes, 4) + 8;
  const end = Math.min(bytes.length, declaredSize);
  let offset = 12;
  while (offset + 8 <= end) {
    const chunkSize = readUint32LE(bytes, offset + 4);
    const dataOffset = offset + 8;
    if (chunkSize > end - dataOffset) return EMPTY_DIMENSIONS;

    if (matchesAscii(bytes, offset, 'VP8X')) return inspectWebpVp8x(bytes, dataOffset, chunkSize);
    if (matchesAscii(bytes, offset, 'VP8 ')) return inspectWebpVp8(bytes, dataOffset, chunkSize);
    if (matchesAscii(bytes, offset, 'VP8L')) return inspectWebpVp8l(bytes, dataOffset, chunkSize);

    const nextOffset = dataOffset + chunkSize + (chunkSize % 2);
    if (nextOffset <= offset || nextOffset > end) return EMPTY_DIMENSIONS;
    offset = nextOffset;
  }
  return EMPTY_DIMENSIONS;
}

function inspectWebpVp8x(bytes: Uint8Array, offset: number, chunkSize: number): ImageDimensions {
  if (chunkSize < 10 || offset + 10 > bytes.length) return EMPTY_DIMENSIONS;
  const width = readUint24LE(bytes, offset + 4) + 1;
  const height = readUint24LE(bytes, offset + 7) + 1;
  return isPositiveDimension(width) && isPositiveDimension(height)
    ? { width, height, hasTransparency: (bytes[offset] & 0x10) !== 0 }
    : EMPTY_DIMENSIONS;
}

function inspectWebpVp8(bytes: Uint8Array, offset: number, chunkSize: number): ImageDimensions {
  if (
    chunkSize < 10 || offset + 10 > bytes.length
    || bytes[offset + 3] !== 0x9d || bytes[offset + 4] !== 0x01 || bytes[offset + 5] !== 0x2a
  ) return EMPTY_DIMENSIONS;
  const width = readUint16LE(bytes, offset + 6) & 0x3fff;
  const height = readUint16LE(bytes, offset + 8) & 0x3fff;
  return isPositiveDimension(width) && isPositiveDimension(height)
    ? { width, height, hasTransparency: false }
    : EMPTY_DIMENSIONS;
}

function inspectWebpVp8l(bytes: Uint8Array, offset: number, chunkSize: number): ImageDimensions {
  if (chunkSize < 5 || offset + 5 > bytes.length || bytes[offset] !== 0x2f) return EMPTY_DIMENSIONS;
  const width = 1 + bytes[offset + 1] + ((bytes[offset + 2] & 0x3f) << 8);
  const height = 1 + (bytes[offset + 2] >> 6) + (bytes[offset + 3] << 2)
    + ((bytes[offset + 4] & 0x0f) << 10);
  return isPositiveDimension(width) && isPositiveDimension(height)
    ? { width, height, hasTransparency: null }
    : EMPTY_DIMENSIONS;
}

function inspectSvg(bytes: Uint8Array): ImageDimensions {
  if (bytes.length > MAX_SVG_BYTES) return EMPTY_DIMENSIONS;

  let svg: string;
  try {
    svg = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return EMPTY_DIMENSIONS;
  }
  const openingTag = svg.match(/<svg\b[^>]*>/i)?.[0];
  if (!openingTag) return EMPTY_DIMENSIONS;

  const width = parseSvgDimension(readSvgAttribute(openingTag, 'width'));
  const height = parseSvgDimension(readSvgAttribute(openingTag, 'height'));
  if (width !== null && height !== null) return { width, height, hasTransparency: null };

  const viewBox = readSvgAttribute(openingTag, 'viewBox');
  const parts = viewBox?.trim().split(/[\s,]+/);
  if (!parts || parts.length !== 4) return EMPTY_DIMENSIONS;
  const values = parts.map(Number);
  if (values.some(value => !Number.isFinite(value)) || !isPositiveDimension(values[2]) || !isPositiveDimension(values[3])) {
    return EMPTY_DIMENSIONS;
  }
  return { width: values[2], height: values[3], hasTransparency: null };
}

function readSvgAttribute(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i'));
  return match?.[2] ?? null;
}

function parseSvgDimension(value: string | null): number | null {
  if (!value) return null;
  const match = value.trim().match(/^((?:\d+(?:\.\d+)?|\.\d+))(?:px)?$/i);
  if (!match) return null;
  const dimension = Number(match[1]);
  return isPositiveDimension(dimension) ? dimension : null;
}

function isPositiveDimension(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function readUint16BE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readUint16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint24LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16)
    | (bytes[offset + 3] << 24)) >>> 0;
}

function matchesAscii(bytes: Uint8Array, offset: number, value: string): boolean {
  return value.split('').every((character, index) => bytes[offset + index] === character.charCodeAt(0));
}
