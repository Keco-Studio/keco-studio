import type { Point } from './mapPlanSchema';

export type BinaryMask = {
  width: number;
  height: number;
  pixels: Uint8Array;
};

function assertDimensions(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError('Mask dimensions must be positive integers');
  }
}

function assertBrushRadius(radius: number): void {
  if (!Number.isFinite(radius) || radius < 0) {
    throw new RangeError('Brush radius must be a non-negative finite number');
  }
}

export function createMask(width: number, height: number): BinaryMask {
  assertDimensions(width, height);
  return { width, height, pixels: new Uint8Array(width * height) };
}

export function paintMask(mask: BinaryMask, center: Point, radius: number): BinaryMask {
  assertDimensions(mask.width, mask.height);
  assertBrushRadius(radius);
  if (mask.pixels.length !== mask.width * mask.height) {
    throw new RangeError('Mask pixel data does not match its dimensions');
  }

  const pixels = new Uint8Array(mask.pixels);
  const minX = Math.max(0, Math.floor(center.x - radius));
  const maxX = Math.min(mask.width - 1, Math.ceil(center.x + radius));
  const minY = Math.max(0, Math.floor(center.y - radius));
  const maxY = Math.min(mask.height - 1, Math.ceil(center.y + radius));
  const radiusSquared = radius * radius;

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const dx = x - center.x;
      const dy = y - center.y;
      if (dx * dx + dy * dy <= radiusSquared) {
        pixels[y * mask.width + x] = 255;
      }
    }
  }

  return { width: mask.width, height: mask.height, pixels };
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const byte of bytes) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function writeUint32(target: Uint8Array, offset: number, value: number): void {
  target[offset] = (value >>> 24) & 0xff;
  target[offset + 1] = (value >>> 16) & 0xff;
  target[offset + 2] = (value >>> 8) & 0xff;
  target[offset + 3] = value & 0xff;
}

function makeChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const chunk = new Uint8Array(data.length + 12);
  writeUint32(chunk, 0, data.length);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  writeUint32(chunk, data.length + 8, crc32(chunk.subarray(4, data.length + 8)));
  return chunk;
}

function deflateStored(data: Uint8Array): Uint8Array {
  const blockCount = Math.max(1, Math.ceil(data.length / 65535));
  const output = new Uint8Array(2 + data.length + blockCount * 5 + 4);
  output[0] = 0x78;
  output[1] = 0x01;
  let inputOffset = 0;
  let outputOffset = 2;

  while (inputOffset < data.length || (data.length === 0 && inputOffset === 0)) {
    const length = Math.min(65535, data.length - inputOffset);
    const finalBlock = inputOffset + length >= data.length;
    output[outputOffset] = finalBlock ? 1 : 0;
    output[outputOffset + 1] = length & 0xff;
    output[outputOffset + 2] = (length >>> 8) & 0xff;
    const inverseLength = (~length) & 0xffff;
    output[outputOffset + 3] = inverseLength & 0xff;
    output[outputOffset + 4] = (inverseLength >>> 8) & 0xff;
    output.set(data.subarray(inputOffset, inputOffset + length), outputOffset + 5);
    inputOffset += length;
    outputOffset += length + 5;
    if (finalBlock) break;
  }

  writeUint32(output, outputOffset, adler32(data));
  return output;
}

export function encodeBinaryMaskPng(mask: BinaryMask): Uint8Array {
  assertDimensions(mask.width, mask.height);
  if (mask.pixels.length !== mask.width * mask.height) {
    throw new RangeError('Mask pixel data does not match its dimensions');
  }

  const rowLength = mask.width * 4 + 1;
  const raw = new Uint8Array(rowLength * mask.height);
  for (let y = 0; y < mask.height; y += 1) {
    const rowOffset = y * rowLength;
    raw[rowOffset] = 0;
    for (let x = 0; x < mask.width; x += 1) {
      const value = mask.pixels[y * mask.width + x] === 255 ? 255 : 0;
      const pixelOffset = rowOffset + 1 + x * 4;
      raw[pixelOffset] = value;
      raw[pixelOffset + 1] = value;
      raw[pixelOffset + 2] = value;
      raw[pixelOffset + 3] = 255;
    }
  }

  const header = new Uint8Array(13);
  writeUint32(header, 0, mask.width);
  writeUint32(header, 4, mask.height);
  header.set([8, 6, 0, 0, 0], 8);
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const chunks = [makeChunk('IHDR', header), makeChunk('IDAT', deflateStored(raw)), makeChunk('IEND', new Uint8Array())];
  const output = new Uint8Array(signature.length + chunks.reduce((total, chunk) => total + chunk.length, 0));
  output.set(signature);
  let offset = signature.length;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}
