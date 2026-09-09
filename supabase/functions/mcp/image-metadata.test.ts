import { assertEquals, assertMatch } from "@std/assert";
import { encode } from "fast-png";
import { type ImageFileType, inspectVerifiedImage } from "./image-metadata.ts";

const jpeg1x1 = new Uint8Array([
  0xff,
  0xd8,
  0xff,
  0xc0,
  0x00,
  0x0b,
  0x08,
  0x00,
  0x01,
  0x00,
  0x01,
  0x01,
  0x01,
  0x11,
  0x00,
  0xff,
  0xd9,
]);
const gif1x1 = new Uint8Array([
  0x47,
  0x49,
  0x46,
  0x38,
  0x39,
  0x61,
  0x01,
  0x00,
  0x01,
  0x00,
  0x00,
  0x00,
  0x00,
]);
const webp1x1 = new Uint8Array([
  0x52,
  0x49,
  0x46,
  0x46,
  0x16,
  0x00,
  0x00,
  0x00,
  0x57,
  0x45,
  0x42,
  0x50,
  0x56,
  0x50,
  0x38,
  0x58,
  0x0a,
  0x00,
  0x00,
  0x00,
  0x10,
  0x00,
  0x00,
  0x00,
  0x00,
  0x00,
  0x00,
  0x00,
  0x00,
  0x00,
]);
const nullMetadata = { width: null, height: null, hasTransparency: null };

function metadataShape(
  result: Awaited<ReturnType<typeof inspectVerifiedImage>>,
) {
  return {
    width: result.width,
    height: result.height,
    hasTransparency: result.hasTransparency,
  };
}

async function assertNullMetadata(fileType: ImageFileType, bytes: Uint8Array) {
  assertEquals(
    metadataShape(await inspectVerifiedImage(fileType, bytes)),
    nullMetadata,
  );
}

function writeUint16LE(bytes: Uint8Array, offset: number, value: number) {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = value >>> 8;
}

function writeUint32LE(bytes: Uint8Array, offset: number, value: number) {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}

function writeUint32BE(bytes: Uint8Array, offset: number, value: number) {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

function writeAscii(bytes: Uint8Array, offset: number, value: string) {
  for (let index = 0; index < value.length; index++) {
    bytes[offset + index] = value.charCodeAt(index);
  }
}

function crc32(bytes: Uint8Array, offset: number, length: number) {
  let crc = 0xffffffff;
  for (let index = offset; index < offset + length; index++) {
    crc ^= bytes[index];
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array) {
  const chunk = new Uint8Array(data.length + 12);
  writeUint32BE(chunk, 0, data.length);
  writeAscii(chunk, 4, type);
  chunk.set(data, 8);
  writeUint32BE(chunk, data.length + 8, crc32(chunk, 4, data.length + 4));
  return chunk;
}

function pngFile(chunks: Uint8Array[]) {
  const length = 8 + chunks.reduce((total, chunk) => total + chunk.length, 0);
  const png = new Uint8Array(length);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  let offset = 8;
  for (const chunk of chunks) {
    png.set(chunk, offset);
    offset += chunk.length;
  }
  return png;
}

function oversizedIhdr() {
  const ihdr = new Uint8Array(13);
  writeUint32BE(ihdr, 0, 32769);
  writeUint32BE(ihdr, 4, 1024);
  ihdr.set([0x08, 0x00, 0x00, 0x00, 0x00], 8);
  return pngChunk("IHDR", ihdr);
}

function webpChunk(type: "VP8X" | "VP8 " | "VP8L", payload: number[]) {
  const padding = payload.length % 2;
  const contentsLength = 4 + 8 + payload.length + padding;
  const bytes = new Uint8Array(8 + contentsLength);
  writeAscii(bytes, 0, "RIFF");
  writeUint32LE(bytes, 4, contentsLength);
  writeAscii(bytes, 8, "WEBP");
  writeAscii(bytes, 12, type);
  writeUint32LE(bytes, 16, payload.length);
  bytes.set(payload, 20);
  return bytes;
}

function jpegSof(
  marker: number,
  width: number,
  height: number,
  components = 1,
) {
  const length = 8 + 3 * components;
  const bytes = new Uint8Array(length + 6);
  bytes.set([0xff, 0xd8, 0xff, marker, length >>> 8, length & 0xff, 0x08], 0);
  bytes[7] = height >>> 8;
  bytes[8] = height & 0xff;
  bytes[9] = width >>> 8;
  bytes[10] = width & 0xff;
  bytes[11] = components;
  for (let component = 0; component < components; component++) {
    const offset = 12 + component * 3;
    bytes.set([component + 1, 0x11, 0x00], offset);
  }
  bytes.set([0xff, 0xd9], bytes.length - 2);
  return bytes;
}

Deno.test("inspects PNG dimensions, alpha, and SHA-256", async () => {
  const bytes = encode({
    width: 2,
    height: 1,
    data: new Uint8Array([255, 0, 0, 255, 0, 255, 0, 0]),
    channels: 4,
    depth: 8,
  });

  const result = await inspectVerifiedImage("image/png", bytes);

  assertEquals(result.width, 2);
  assertEquals(result.height, 1);
  assertEquals(result.hasTransparency, true);
  assertMatch(result.sha256, /^[a-f0-9]{64}$/);
});

Deno.test("preserves proven oversized PNG dimensions without decoding pixels", async () => {
  const width = 32769;
  const height = 1024;
  const bytes = encode({
    width,
    height,
    data: new Uint8Array(width * height),
    channels: 1,
    depth: 8,
  });

  assertEquals(bytes.length <= 5 * 1024 * 1024, true);
  assertEquals(metadataShape(await inspectVerifiedImage("image/png", bytes)), {
    width,
    height,
    hasTransparency: null,
  });
});

Deno.test("rejects an oversized PNG with only a valid IHDR chunk", async () => {
  const bytes = pngFile([oversizedIhdr()]);

  assertEquals(bytes.length, 33);
  await assertNullMetadata("image/png", bytes);
});

Deno.test("rejects malformed oversized PNG chunk ordering and CRCs", async () => {
  const idat = pngChunk("IDAT", new Uint8Array([0x78]));
  const iend = pngChunk("IEND", new Uint8Array());
  const duplicateIhdr = pngFile([oversizedIhdr(), idat, oversizedIhdr(), iend]);
  const corruptedIdat = idat.slice();
  corruptedIdat[corruptedIdat.length - 1] ^= 0x01;
  const badCrc = pngFile([oversizedIhdr(), corruptedIdat, iend]);
  const invalidChunkType = pngFile([
    oversizedIhdr(),
    idat,
    pngChunk("a123", new Uint8Array()),
    iend,
  ]);

  await assertNullMetadata("image/png", duplicateIhdr);
  await assertNullMetadata("image/png", badCrc);
  await assertNullMetadata("image/png", invalidChunkType);
});

Deno.test("reports opaque PNG data as non-transparent", async () => {
  const bytes = encode({
    width: 1,
    height: 1,
    data: new Uint8Array([255, 0, 0, 255]),
    channels: 4,
    depth: 8,
  });

  assertEquals(
    (await inspectVerifiedImage("image/png", bytes)).hasTransparency,
    false,
  );
});

Deno.test("reports opaque 16-bit PNG alpha data as non-transparent", async () => {
  const bytes = encode({
    width: 1,
    height: 1,
    data: new Uint16Array([65535, 0, 0, 65535]),
    channels: 4,
    depth: 16,
  });

  assertEquals(
    (await inspectVerifiedImage("image/png", bytes)).hasTransparency,
    false,
  );
});

Deno.test("inspects JPEG, GIF, WebP, and SVG without executing content", async () => {
  assertEquals((await inspectVerifiedImage("image/jpeg", jpeg1x1)).width, 1);
  assertEquals((await inspectVerifiedImage("image/gif", gif1x1)).height, 1);
  assertEquals((await inspectVerifiedImage("image/webp", webp1x1)).width, 1);
  const svg = await inspectVerifiedImage(
    "image/svg+xml",
    new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 7"></svg>',
    ),
  );
  assertEquals({
    width: svg.width,
    height: svg.height,
    hasTransparency: svg.hasTransparency,
  }, {
    width: 12,
    height: 7,
    hasTransparency: null,
  });
  assertMatch(svg.sha256, /^[a-f0-9]{64}$/);
});

Deno.test("walks JPEG markers and accepts structurally valid SOF1 and SOF2 segments", async () => {
  const sof1 = jpegSof(0xc1, 4, 3);
  const withAppMarker = new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xe0,
    0x00,
    0x04,
    0x00,
    0x00,
    ...sof1.slice(2),
  ]);
  const sof2 = jpegSof(0xc2, 5, 2, 3);

  assertEquals(
    metadataShape(await inspectVerifiedImage("image/jpeg", withAppMarker)),
    {
      width: 4,
      height: 3,
      hasTransparency: false,
    },
  );
  assertEquals(metadataShape(await inspectVerifiedImage("image/jpeg", sof2)), {
    width: 5,
    height: 2,
    hasTransparency: false,
  });
});

Deno.test("rejects malformed JPEG SOF length declarations", async () => {
  const malformed = jpegSof(0xc0, 1, 1);
  malformed[4] = 0x00;
  malformed[5] = 0x08;

  await assertNullMetadata("image/jpeg", malformed);
});

Deno.test("parses VP8X alpha and VP8 or VP8L dimensions", async () => {
  const vp8x = webpChunk("VP8X", [
    0x10,
    0x00,
    0x00,
    0x00,
    0x03,
    0x00,
    0x00,
    0x02,
    0x00,
    0x00,
  ]);
  const vp8 = webpChunk("VP8 ", [
    0x00,
    0x00,
    0x00,
    0x9d,
    0x01,
    0x2a,
    0x04,
    0x00,
    0x03,
    0x00,
  ]);
  const vp8l = webpChunk("VP8L", [0x2f, 0x03, 0x80, 0x00, 0x00]);

  assertEquals(metadataShape(await inspectVerifiedImage("image/webp", vp8x)), {
    width: 4,
    height: 3,
    hasTransparency: true,
  });
  assertEquals(metadataShape(await inspectVerifiedImage("image/webp", vp8)), {
    width: 4,
    height: 3,
    hasTransparency: false,
  });
  assertEquals(metadataShape(await inspectVerifiedImage("image/webp", vp8l)), {
    width: 4,
    height: 3,
    hasTransparency: null,
  });
});

Deno.test("rejects non-key VP8 frames and nonzero VP8L versions", async () => {
  const nonKeyVp8 = webpChunk("VP8 ", [
    0x01,
    0x00,
    0x00,
    0x9d,
    0x01,
    0x2a,
    0x04,
    0x00,
    0x03,
    0x00,
  ]);
  const nonzeroVp8lVersion = webpChunk("VP8L", [0x2f, 0x03, 0x80, 0x00, 0x20]);

  await assertNullMetadata("image/webp", nonKeyVp8);
  await assertNullMetadata("image/webp", nonzeroVp8lVersion);
});

Deno.test("returns null metadata for truncated or zero-dimension headers", async () => {
  const truncated = await inspectVerifiedImage(
    "image/jpeg",
    jpeg1x1.slice(0, 8),
  );
  const zeroSizeGif = await inspectVerifiedImage(
    "image/gif",
    new Uint8Array([
      0x47,
      0x49,
      0x46,
      0x38,
      0x39,
      0x61,
      0x00,
      0x00,
      0x01,
      0x00,
      0x00,
      0x00,
      0x00,
    ]),
  );

  assertEquals(
    {
      width: truncated.width,
      height: truncated.height,
      hasTransparency: truncated.hasTransparency,
    },
    { width: null, height: null, hasTransparency: null },
  );
  assertEquals(
    {
      width: zeroSizeGif.width,
      height: zeroSizeGif.height,
      hasTransparency: zeroSizeGif.hasTransparency,
    },
    { width: null, height: null, hasTransparency: null },
  );
});

Deno.test("rejects truncated binary headers for every supported raster format", async () => {
  const png = encode({
    width: 1,
    height: 1,
    data: new Uint8Array([0]),
    channels: 1,
    depth: 8,
  });

  await assertNullMetadata("image/png", png.slice(0, 20));
  await assertNullMetadata("image/jpeg", jpeg1x1.slice(0, 8));
  await assertNullMetadata("image/gif", gif1x1.slice(0, 10));
  await assertNullMetadata("image/webp", webp1x1.slice(0, 22));
});

Deno.test("rejects percentage SVG dimensions without a valid viewBox", async () => {
  const result = await inspectVerifiedImage(
    "image/svg+xml",
    new TextEncoder().encode('<svg width="100%" height="50%"></svg>'),
  );

  assertEquals(
    {
      width: result.width,
      height: result.height,
      hasTransparency: result.hasTransparency,
    },
    { width: null, height: null, hasTransparency: null },
  );
});

Deno.test("ignores commented SVG lookalikes and prefixed attributes", async () => {
  const comment = await inspectVerifiedImage(
    "image/svg+xml",
    new TextEncoder().encode(
      '<!-- <svg width="13" height="11"></svg> --><svg width="2" height="3"></svg>',
    ),
  );
  const prefixed = await inspectVerifiedImage(
    "image/svg+xml",
    new TextEncoder().encode(
      '<svg data-width="13" stroke-width="11" width="2" height="3"></svg>',
    ),
  );

  assertEquals(metadataShape(comment), {
    width: 2,
    height: 3,
    hasTransparency: null,
  });
  assertEquals(metadataShape(prefixed), {
    width: 2,
    height: 3,
    hasTransparency: null,
  });
});

Deno.test("rejects malformed SVG self-closing tags", async () => {
  await assertNullMetadata(
    "image/svg+xml",
    new TextEncoder().encode('<svg width="2" height="3" / malformed>'),
  );
});

Deno.test("accepts SVG decimal exponents and rejects hexadecimal viewBox values", async () => {
  const dimensions = await inspectVerifiedImage(
    "image/svg+xml",
    new TextEncoder().encode('<svg width="+1.5e1px" height=".2E2"></svg>'),
  );
  const hexadecimalViewBox = await inspectVerifiedImage(
    "image/svg+xml",
    new TextEncoder().encode('<svg viewBox="0 0 0x10 2"></svg>'),
  );

  assertEquals(metadataShape(dimensions), {
    width: 15,
    height: 20,
    hasTransparency: null,
  });
  assertEquals(metadataShape(hexadecimalViewBox), nullMetadata);
});

Deno.test("hashes identical bytes deterministically", async () => {
  const bytes = new TextEncoder().encode('<svg width="3" height="2"></svg>');

  const [first, second] = await Promise.all([
    inspectVerifiedImage("image/svg+xml", bytes),
    inspectVerifiedImage("image/svg+xml", bytes.slice()),
  ]);

  assertEquals(first.sha256, second.sha256);
});

Deno.test("hashes exact bytes with a known digest, including a subarray offset", async () => {
  const bytes = new Uint8Array([0, 97, 98, 99, 0]);
  const result = await inspectVerifiedImage(
    "image/svg+xml",
    bytes.subarray(1, 4),
  );

  assertEquals(
    result.sha256,
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});
