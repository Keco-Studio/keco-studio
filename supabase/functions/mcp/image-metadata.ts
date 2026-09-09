import { decode } from "fast-png";
import { Inflate } from "pako";

export type ImageFileType =
  | "image/png"
  | "image/jpeg"
  | "image/gif"
  | "image/webp"
  | "image/svg+xml";

export type VerifiedImageMetadata = {
  sha256: string;
  width: number | null;
  height: number | null;
  hasTransparency: boolean | null;
};

type ImageDimensions = Omit<VerifiedImageMetadata, "sha256">;

const EMPTY_DIMENSIONS: ImageDimensions = {
  width: null,
  height: null,
  hasTransparency: null,
};
const MAX_SVG_BYTES = 5 * 1024 * 1024;
const MAX_DECODED_PNG_BYTES = 32 * 1024 * 1024;
const MAX_PNG_INFLATE_CHUNK_BYTES = 64 * 1024;
const POSTGRES_INT4_MAX = 2_147_483_647;
const SVG_NUMBER =
  "[+-]?(?:(?:\\d+(?:\\.\\d*)?)|(?:\\.\\d+))(?:[eE][+-]?\\d+)?";
const SVG_NUMBER_PATTERN = new RegExp(`^${SVG_NUMBER}$`);
const SVG_VIEW_BOX_PATTERN = new RegExp(
  `^\\s*(${SVG_NUMBER})(?:\\s*,\\s*|\\s+)(${SVG_NUMBER})(?:\\s*,\\s*|\\s+)(${SVG_NUMBER})(?:\\s*,\\s*|\\s+)(${SVG_NUMBER})\\s*$`,
);

export async function inspectVerifiedImage(
  fileType: ImageFileType,
  bytes: Uint8Array,
): Promise<VerifiedImageMetadata> {
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice().buffer);
  const sha256 = Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  const dimensions = fileType === "image/png"
    ? inspectPng(bytes)
    : fileType === "image/jpeg"
    ? inspectJpeg(bytes)
    : fileType === "image/gif"
    ? inspectGif(bytes)
    : fileType === "image/webp"
    ? inspectWebp(bytes)
    : inspectSvg(bytes);
  return { sha256, ...dimensions };
}

function inspectPng(bytes: Uint8Array): ImageDimensions {
  const header = readPngHeader(bytes);
  if (!header) return EMPTY_DIMENSIONS;
  const chunks = readPngChunks(bytes, header);
  if (!chunks) return EMPTY_DIMENSIONS;
  if (
    decodedPngBytesExceedLimit(
      header.width,
      header.height,
      header.channels,
      header.depth,
    )
  ) {
    return {
      width: header.width,
      height: header.height,
      hasTransparency: null,
    };
  }

  const scanlineBytes = expectedPngScanlineBytes(header);
  if (
    scanlineBytes === null ||
    !hasExactInflatedSize(chunks.idat, scanlineBytes)
  ) return EMPTY_DIMENSIONS;

  try {
    const decoded = decode(rebuildPngForPixelDecode(bytes, chunks), {
      checkCrc: true,
    });
    if (decoded.width !== header.width || decoded.height !== header.height) {
      return EMPTY_DIMENSIONS;
    }
    if (decoded.channels !== 2 && decoded.channels !== 4) {
      return {
        width: decoded.width,
        height: decoded.height,
        hasTransparency: pngTransparencyFromColorKey(
          decoded.data,
          header,
          chunks,
        ),
      };
    }

    const opaqueAlpha = decoded.depth === 16 ? 65535 : 255;
    for (
      let index = decoded.channels - 1;
      index < decoded.data.length;
      index += decoded.channels
    ) {
      if (decoded.data[index] !== opaqueAlpha) {
        return {
          width: decoded.width,
          height: decoded.height,
          hasTransparency: true,
        };
      }
    }
    return {
      width: decoded.width,
      height: decoded.height,
      hasTransparency: false,
    };
  } catch {
    return EMPTY_DIMENSIONS;
  }
}

type PngHeader = {
  width: number;
  height: number;
  channels: number;
  depth: number;
  colorType: number;
  interlace: number;
};

type PngChunk = {
  data: Uint8Array;
  framed: Uint8Array;
};

type PngChunks = {
  ihdr: PngChunk;
  palette: PngChunk | null;
  transparency: PngChunk | null;
  idat: PngChunk[];
  iend: PngChunk;
};

function inspectJpeg(bytes: Uint8Array): ImageDimensions {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return EMPTY_DIMENSIONS;
  }

  let offset = 2;
  while (offset + 1 < bytes.length) {
    while (offset < bytes.length && bytes[offset] === 0xff) offset++;
    if (offset >= bytes.length) return EMPTY_DIMENSIONS;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda) return EMPTY_DIMENSIONS;
    if (
      marker === 0x00 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)
    ) continue;
    if (offset + 1 >= bytes.length) return EMPTY_DIMENSIONS;

    const length = readUint16BE(bytes, offset);
    if (length < 2 || offset + length > bytes.length) return EMPTY_DIMENSIONS;
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      if (length < 8) return EMPTY_DIMENSIONS;
      const height = readUint16BE(bytes, offset + 3);
      const width = readUint16BE(bytes, offset + 5);
      const components = bytes[offset + 7];
      if (components === 0 || length !== 8 + 3 * components) {
        return EMPTY_DIMENSIONS;
      }
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
    bytes.length < 13 ||
    bytes[0] !== 0x47 || bytes[1] !== 0x49 || bytes[2] !== 0x46 ||
    bytes[3] !== 0x38 || (bytes[4] !== 0x37 && bytes[4] !== 0x39) ||
    bytes[5] !== 0x61
  ) return EMPTY_DIMENSIONS;

  const width = readUint16LE(bytes, 6);
  const height = readUint16LE(bytes, 8);
  return isPositiveDimension(width) && isPositiveDimension(height)
    ? { width, height, hasTransparency: null }
    : EMPTY_DIMENSIONS;
}

function inspectWebp(bytes: Uint8Array): ImageDimensions {
  if (
    bytes.length < 20 ||
    !matchesAscii(bytes, 0, "RIFF") ||
    !matchesAscii(bytes, 8, "WEBP")
  ) return EMPTY_DIMENSIONS;

  const declaredSize = readUint32LE(bytes, 4) + 8;
  const end = Math.min(bytes.length, declaredSize);
  let offset = 12;
  while (offset + 8 <= end) {
    const chunkSize = readUint32LE(bytes, offset + 4);
    const dataOffset = offset + 8;
    if (chunkSize > end - dataOffset) return EMPTY_DIMENSIONS;

    if (matchesAscii(bytes, offset, "VP8X")) {
      return inspectWebpVp8x(bytes, dataOffset, chunkSize);
    }
    if (matchesAscii(bytes, offset, "VP8 ")) {
      return inspectWebpVp8(bytes, dataOffset, chunkSize);
    }
    if (matchesAscii(bytes, offset, "VP8L")) {
      return inspectWebpVp8l(bytes, dataOffset, chunkSize);
    }

    const nextOffset = dataOffset + chunkSize + (chunkSize % 2);
    if (nextOffset <= offset || nextOffset > end) return EMPTY_DIMENSIONS;
    offset = nextOffset;
  }
  return EMPTY_DIMENSIONS;
}

function inspectWebpVp8x(
  bytes: Uint8Array,
  offset: number,
  chunkSize: number,
): ImageDimensions {
  if (chunkSize < 10 || offset + 10 > bytes.length) return EMPTY_DIMENSIONS;
  const width = readUint24LE(bytes, offset + 4) + 1;
  const height = readUint24LE(bytes, offset + 7) + 1;
  return isPositiveDimension(width) && isPositiveDimension(height)
    ? { width, height, hasTransparency: (bytes[offset] & 0x10) !== 0 }
    : EMPTY_DIMENSIONS;
}

function inspectWebpVp8(
  bytes: Uint8Array,
  offset: number,
  chunkSize: number,
): ImageDimensions {
  if (
    chunkSize < 10 || offset + 10 > bytes.length ||
    (bytes[offset] & 0x01) !== 0 ||
    bytes[offset + 3] !== 0x9d || bytes[offset + 4] !== 0x01 ||
    bytes[offset + 5] !== 0x2a
  ) return EMPTY_DIMENSIONS;
  const width = readUint16LE(bytes, offset + 6) & 0x3fff;
  const height = readUint16LE(bytes, offset + 8) & 0x3fff;
  return isPositiveDimension(width) && isPositiveDimension(height)
    ? { width, height, hasTransparency: false }
    : EMPTY_DIMENSIONS;
}

function inspectWebpVp8l(
  bytes: Uint8Array,
  offset: number,
  chunkSize: number,
): ImageDimensions {
  if (
    chunkSize < 5 ||
    offset + 5 > bytes.length ||
    bytes[offset] !== 0x2f ||
    (bytes[offset + 4] & 0xe0) !== 0
  ) return EMPTY_DIMENSIONS;
  const width = 1 + bytes[offset + 1] + ((bytes[offset + 2] & 0x3f) << 8);
  const height = 1 + (bytes[offset + 2] >> 6) + (bytes[offset + 3] << 2) +
    ((bytes[offset + 4] & 0x0f) << 10);
  return isPositiveDimension(width) && isPositiveDimension(height)
    ? { width, height, hasTransparency: null }
    : EMPTY_DIMENSIONS;
}

function inspectSvg(bytes: Uint8Array): ImageDimensions {
  if (bytes.length > MAX_SVG_BYTES) return EMPTY_DIMENSIONS;

  let svg: string;
  try {
    svg = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return EMPTY_DIMENSIONS;
  }
  const openingTag = readSvgRootTag(svg);
  if (!openingTag) return EMPTY_DIMENSIONS;

  const attributes = readSvgAttributes(openingTag);
  if (!attributes) return EMPTY_DIMENSIONS;
  const width = parseSvgDimension(attributes.get("width") ?? null);
  const height = parseSvgDimension(attributes.get("height") ?? null);
  if (width !== null && height !== null) {
    return { width, height, hasTransparency: null };
  }

  const viewBox = attributes.get("viewBox");
  const match = viewBox?.match(SVG_VIEW_BOX_PATTERN);
  if (!match) return EMPTY_DIMENSIONS;
  const values = match.slice(1).map(parseSvgNumber);
  if (
    values.some((value) => value === null) ||
    !isPostgresInt4Dimension(values[2]!) ||
    !isPostgresInt4Dimension(values[3]!)
  ) {
    return EMPTY_DIMENSIONS;
  }
  return { width: values[2]!, height: values[3]!, hasTransparency: null };
}

function readSvgRootTag(svg: string): string | null {
  let offset = svg.charCodeAt(0) === 0xfeff ? 1 : 0;
  while (offset < svg.length) {
    offset = skipWhitespace(svg, offset);
    if (svg.startsWith("<!--", offset)) {
      const end = svg.indexOf("-->", offset + 4);
      if (end === -1) return null;
      offset = end + 3;
      continue;
    }
    if (svg.startsWith("<?", offset)) {
      const end = svg.indexOf("?>", offset + 2);
      if (end === -1) return null;
      offset = end + 2;
      continue;
    }
    if (!svg.startsWith("<svg", offset) || !isTagBoundary(svg[offset + 4])) {
      return null;
    }

    const end = findTagEnd(svg, offset + 4);
    return end === -1 ? null : svg.slice(offset, end + 1);
  }
  return null;
}

function readSvgAttributes(tag: string): Map<string, string> | null {
  const attributes = new Map<string, string>();
  let offset = 4;
  while (offset < tag.length) {
    offset = skipWhitespace(tag, offset);
    if (tag[offset] === ">") return attributes;
    if (tag[offset] === "/") {
      return skipWhitespace(tag, offset + 1) === tag.length - 1
        ? attributes
        : null;
    }

    const nameStart = offset;
    while (offset < tag.length && !isAttributeBoundary(tag[offset])) offset++;
    if (nameStart === offset) return null;
    const name = tag.slice(nameStart, offset);
    offset = skipWhitespace(tag, offset);
    if (tag[offset] !== "=") return null;
    offset = skipWhitespace(tag, offset + 1);
    const quote = tag[offset];
    if (quote !== '"' && quote !== "'") return null;
    const valueStart = offset + 1;
    const valueEnd = tag.indexOf(quote, valueStart);
    if (valueEnd === -1) return null;
    if (attributes.has(name)) return null;
    attributes.set(name, tag.slice(valueStart, valueEnd));
    offset = valueEnd + 1;
  }
  return null;
}

function parseSvgDimension(value: string | null): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  const numericValue = trimmed.endsWith("px") ? trimmed.slice(0, -2) : trimmed;
  const dimension = parseSvgNumber(numericValue);
  return dimension !== null && isPostgresInt4Dimension(dimension)
    ? dimension
    : null;
}

function parseSvgNumber(value: string): number | null {
  if (!SVG_NUMBER_PATTERN.test(value)) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isPositiveDimension(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function isPostgresInt4Dimension(value: number): boolean {
  return Number.isInteger(value) && value > 0 && value <= POSTGRES_INT4_MAX;
}

function readUint16BE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) |
    (bytes[offset + 2] << 8) |
    bytes[offset + 3]) >>> 0;
}

function readUint16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint24LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)) >>> 0;
}

function matchesAscii(
  bytes: Uint8Array,
  offset: number,
  value: string,
): boolean {
  return value.split("").every((character, index) =>
    bytes[offset + index] === character.charCodeAt(0)
  );
}

function readPngHeader(
  bytes: Uint8Array,
): PngHeader | null {
  if (
    bytes.length < 33 ||
    !matchesBytes(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) ||
    readUint32BE(bytes, 8) !== 13 ||
    !matchesAscii(bytes, 12, "IHDR") ||
    readUint32BE(bytes, 29) !== crc32(bytes, 12, 17)
  ) return null;

  const width = readUint32BE(bytes, 16);
  const height = readUint32BE(bytes, 20);
  const depth = bytes[24];
  const colorType = bytes[25];
  const channels = pngChannels(colorType);
  if (
    !isPositiveDimension(width) ||
    !isPositiveDimension(height) ||
    channels === null ||
    !validPngDepth(colorType, depth) ||
    bytes[26] !== 0 ||
    bytes[27] !== 0 ||
    (bytes[28] !== 0 && bytes[28] !== 1)
  ) return null;
  return {
    width,
    height,
    channels,
    depth,
    colorType,
    interlace: bytes[28],
  };
}

function readPngChunks(
  bytes: Uint8Array,
  header: PngHeader,
): PngChunks | null {
  let offset = 8;
  let sawIhdr = false;
  let sawPlte = false;
  let sawTransparency = false;
  let sawIdat = false;
  let endedIdat = false;
  let idatDataBytes = 0;
  let ihdr: PngChunk | null = null;
  let palette: PngChunk | null = null;
  let transparency: PngChunk | null = null;
  const idat: PngChunk[] = [];

  while (offset < bytes.length) {
    if (bytes.length - offset < 12) return null;
    const length = readUint32BE(bytes, offset);
    const typeOffset = offset + 4;
    const dataOffset = offset + 8;
    if (length > bytes.length - dataOffset - 4) return null;
    if (!isValidPngChunkType(bytes, typeOffset)) return null;
    const crcOffset = dataOffset + length;
    if (
      readUint32BE(bytes, crcOffset) !== crc32(bytes, typeOffset, length + 4)
    ) {
      return null;
    }
    const chunk = {
      data: bytes.subarray(dataOffset, crcOffset),
      framed: bytes.subarray(offset, crcOffset + 4),
    };

    if (!sawIhdr) {
      if (length !== 13 || !matchesAscii(bytes, typeOffset, "IHDR")) {
        return null;
      }
      sawIhdr = true;
      ihdr = chunk;
    } else if (matchesAscii(bytes, typeOffset, "IHDR")) {
      return null;
    } else if (matchesAscii(bytes, typeOffset, "PLTE")) {
      if (
        sawPlte || sawTransparency || sawIdat || length === 0 ||
        length % 3 !== 0 || length > 768
      ) {
        return null;
      }
      if (header.colorType === 0 || header.colorType === 4) return null;
      if (header.colorType === 3 && length / 3 > 2 ** header.depth) return null;
      sawPlte = true;
      palette = chunk;
    } else if (matchesAscii(bytes, typeOffset, "tRNS")) {
      if (
        sawTransparency || sawIdat ||
        !validPngTransparencyChunk(header, length, palette)
      ) return null;
      sawTransparency = true;
      transparency = chunk;
    } else if (matchesAscii(bytes, typeOffset, "IDAT")) {
      if (endedIdat || (header.colorType === 3 && !sawPlte)) return null;
      sawIdat = true;
      idatDataBytes += length;
      idat.push(chunk);
    } else if (matchesAscii(bytes, typeOffset, "IEND")) {
      return length === 0 && sawIdat && idatDataBytes > 0 && ihdr &&
          (header.colorType !== 3 || sawPlte) &&
          crcOffset + 4 === bytes.length
        ? { ihdr, palette, transparency, idat, iend: chunk }
        : null;
    } else {
      if (sawIdat) endedIdat = true;
      if (isPngCriticalChunk(bytes[typeOffset])) return null;
    }

    offset = crcOffset + 4;
  }
  return null;
}

function validPngTransparencyChunk(
  header: PngHeader,
  length: number,
  palette: PngChunk | null,
): boolean {
  if (header.colorType === 0) return length === 2;
  if (header.colorType === 2) return length === 6;
  if (header.colorType === 3) {
    return palette !== null && length >= 1 && length <= palette.data.length / 3;
  }
  return false;
}

function expectedPngScanlineBytes(header: PngHeader): number | null {
  if (header.interlace === 0) {
    return checkedScanlineBytes(
      header.width,
      header.height,
      header.channels,
      header.depth,
    );
  }

  let total = 0;
  for (
    const pass of [
      { x: 0, y: 0, xStep: 8, yStep: 8 },
      { x: 4, y: 0, xStep: 8, yStep: 8 },
      { x: 0, y: 4, xStep: 4, yStep: 8 },
      { x: 2, y: 0, xStep: 4, yStep: 4 },
      { x: 0, y: 2, xStep: 2, yStep: 4 },
      { x: 1, y: 0, xStep: 2, yStep: 2 },
      { x: 0, y: 1, xStep: 1, yStep: 2 },
    ]
  ) {
    if (header.width <= pass.x || header.height <= pass.y) continue;
    const width = Math.ceil((header.width - pass.x) / pass.xStep);
    const height = Math.ceil((header.height - pass.y) / pass.yStep);
    const passBytes = checkedScanlineBytes(
      width,
      height,
      header.channels,
      header.depth,
    );
    if (passBytes === null || total > MAX_DECODED_PNG_BYTES - passBytes) {
      return null;
    }
    total += passBytes;
  }
  return total;
}

function checkedScanlineBytes(
  width: number,
  height: number,
  channels: number,
  depth: number,
): number | null {
  const bytesPerLine = Math.ceil(width * channels * depth / 8);
  const bytesPerScanline = bytesPerLine + 1;
  if (bytesPerScanline > Math.floor(MAX_DECODED_PNG_BYTES / height)) {
    return null;
  }
  return bytesPerScanline * height;
}

function hasExactInflatedSize(
  idat: readonly PngChunk[],
  expectedBytes: number,
): boolean {
  const inflator = new Inflate({
    chunkSize: Math.max(
      1,
      Math.min(MAX_PNG_INFLATE_CHUNK_BYTES, expectedBytes + 1),
    ),
  });
  let inflatedBytes = 0;
  let exceeded = false;
  inflator.onData = (chunk) => {
    inflatedBytes += (chunk as Uint8Array).byteLength;
    if (inflatedBytes > expectedBytes) {
      exceeded = true;
      throw new RangeError("PNG IDAT exceeded its scanline budget.");
    }
  };
  try {
    for (const [index, chunk] of idat.entries()) {
      if (!inflator.push(chunk.data, index === idat.length - 1)) return false;
    }
  } catch {
    return false;
  }
  return !exceeded && inflator.err === 0 && inflatedBytes === expectedBytes;
}

function rebuildPngForPixelDecode(
  bytes: Uint8Array,
  chunks: PngChunks,
): Uint8Array {
  const framed = [
    bytes.subarray(0, 8),
    chunks.ihdr.framed,
    ...(chunks.palette ? [chunks.palette.framed] : []),
    ...chunks.idat.map((chunk) => chunk.framed),
    chunks.iend.framed,
  ];
  const result = new Uint8Array(
    framed.reduce((length, chunk) => length + chunk.byteLength, 0),
  );
  let offset = 0;
  for (const chunk of framed) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function pngTransparencyFromColorKey(
  data: Uint8Array | Uint8ClampedArray | Uint16Array,
  header: PngHeader,
  chunks: PngChunks,
): boolean | null {
  const transparency = chunks.transparency?.data;
  if (!transparency) return false;
  if (header.interlace === 1 && header.depth < 8) return null;

  if (header.colorType === 0) {
    const transparentSample = readUint16BE(transparency, 0);
    if (transparentSample >= 2 ** header.depth) return null;
    if (header.depth >= 8) {
      return Array.from(data).some((sample) => sample === transparentSample);
    }
    return packedPngSamples(data, header).some((sample) =>
      sample === transparentSample
    );
  }
  if (header.colorType === 2) {
    const transparent = [
      readUint16BE(transparency, 0),
      readUint16BE(transparency, 2),
      readUint16BE(transparency, 4),
    ];
    const maximum = header.depth === 16 ? 65535 : 255;
    if (transparent.some((sample) => sample > maximum)) return null;
    for (let offset = 0; offset < data.length; offset += 3) {
      if (
        data[offset] === transparent[0] &&
        data[offset + 1] === transparent[1] &&
        data[offset + 2] === transparent[2]
      ) return true;
    }
    return false;
  }
  if (header.colorType === 3) {
    const indexes = header.depth === 8
      ? Array.from(data)
      : packedPngSamples(data, header);
    return indexes.some((index) => (transparency[index] ?? 255) < 255);
  }
  return null;
}

function packedPngSamples(
  data: Uint8Array | Uint8ClampedArray | Uint16Array,
  header: PngHeader,
): number[] {
  const samples: number[] = [];
  const bytesPerLine = Math.ceil(header.width * header.depth / 8);
  const mask = (1 << header.depth) - 1;
  for (let y = 0; y < header.height; y++) {
    const rowOffset = y * bytesPerLine;
    for (let x = 0; x < header.width; x++) {
      const bitOffset = x * header.depth;
      const byte = data[rowOffset + Math.floor(bitOffset / 8)];
      const shift = 8 - header.depth - (bitOffset % 8);
      samples.push((byte >> shift) & mask);
    }
  }
  return samples;
}

function decodedPngBytesExceedLimit(
  width: number,
  height: number,
  channels: number,
  depth: number,
): boolean {
  const bytesPerSample = depth === 16 ? 2 : 1;
  let predictedBytes = width;
  for (const factor of [height, channels, bytesPerSample]) {
    if (predictedBytes > Math.floor(MAX_DECODED_PNG_BYTES / factor)) {
      return true;
    }
    predictedBytes *= factor;
  }
  return predictedBytes > MAX_DECODED_PNG_BYTES;
}

function pngChannels(colorType: number): number | null {
  if (colorType === 0 || colorType === 3) return 1;
  if (colorType === 2) return 3;
  if (colorType === 4) return 2;
  if (colorType === 6) return 4;
  return null;
}

function validPngDepth(colorType: number, depth: number): boolean {
  if (colorType === 0) {
    return depth === 1 || depth === 2 || depth === 4 || depth === 8 ||
      depth === 16;
  }
  if (colorType === 2 || colorType === 4 || colorType === 6) {
    return depth === 8 || depth === 16;
  }
  return colorType === 3 &&
    (depth === 1 || depth === 2 || depth === 4 || depth === 8);
}

function matchesBytes(
  bytes: Uint8Array,
  offset: number,
  expected: number[],
): boolean {
  return expected.every((value, index) => bytes[offset + index] === value);
}

function crc32(bytes: Uint8Array, offset: number, length: number): number {
  let crc = 0xffffffff;
  for (let index = offset; index < offset + length; index++) {
    crc ^= bytes[index];
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function isPngCriticalChunk(firstTypeByte: number): boolean {
  return firstTypeByte >= 0x41 && firstTypeByte <= 0x5a;
}

function isValidPngChunkType(bytes: Uint8Array, offset: number): boolean {
  for (let index = 0; index < 4; index++) {
    const value = bytes[offset + index];
    if (
      !((value >= 0x41 && value <= 0x5a) || (value >= 0x61 && value <= 0x7a))
    ) {
      return false;
    }
  }
  return bytes[offset + 2] >= 0x41 && bytes[offset + 2] <= 0x5a;
}

function skipWhitespace(value: string, offset: number): number {
  while (offset < value.length && /\s/.test(value[offset])) offset++;
  return offset;
}

function isTagBoundary(value: string | undefined): boolean {
  return value === undefined || value === ">" || value === "/" ||
    /\s/.test(value);
}

function findTagEnd(value: string, offset: number): number {
  let quote: string | null = null;
  for (let index = offset; index < value.length; index++) {
    const character = value[index];
    if (quote) {
      if (character === quote) quote = null;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      return index;
    }
  }
  return -1;
}

function isAttributeBoundary(value: string): boolean {
  return value === "=" || value === ">" || value === "/" || /\s/.test(value);
}
