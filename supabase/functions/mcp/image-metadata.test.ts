import { assertEquals, assertMatch } from '@std/assert';
import { encode } from 'fast-png';
import { inspectVerifiedImage } from './image-metadata.ts';

const jpeg1x1 = new Uint8Array([
  0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01,
  0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xd9,
]);
const gif1x1 = new Uint8Array([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00,
  0x01, 0x00, 0x00, 0x00, 0x00,
]);
const webp1x1 = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x16, 0x00, 0x00, 0x00,
  0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58,
  0x0a, 0x00, 0x00, 0x00, 0x10, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);

Deno.test('inspects PNG dimensions, alpha, and SHA-256', async () => {
  const bytes = encode({
    width: 2,
    height: 1,
    data: new Uint8Array([255, 0, 0, 255, 0, 255, 0, 0]),
    channels: 4,
    depth: 8,
  });

  const result = await inspectVerifiedImage('image/png', bytes);

  assertEquals(result.width, 2);
  assertEquals(result.height, 1);
  assertEquals(result.hasTransparency, true);
  assertMatch(result.sha256, /^[a-f0-9]{64}$/);
});

Deno.test('reports opaque PNG data as non-transparent', async () => {
  const bytes = encode({
    width: 1,
    height: 1,
    data: new Uint8Array([255, 0, 0, 255]),
    channels: 4,
    depth: 8,
  });

  assertEquals((await inspectVerifiedImage('image/png', bytes)).hasTransparency, false);
});

Deno.test('reports opaque 16-bit PNG alpha data as non-transparent', async () => {
  const bytes = encode({
    width: 1,
    height: 1,
    data: new Uint16Array([65535, 0, 0, 65535]),
    channels: 4,
    depth: 16,
  });

  assertEquals((await inspectVerifiedImage('image/png', bytes)).hasTransparency, false);
});

Deno.test('inspects JPEG, GIF, WebP, and SVG without executing content', async () => {
  assertEquals((await inspectVerifiedImage('image/jpeg', jpeg1x1)).width, 1);
  assertEquals((await inspectVerifiedImage('image/gif', gif1x1)).height, 1);
  assertEquals((await inspectVerifiedImage('image/webp', webp1x1)).width, 1);
  const svg = await inspectVerifiedImage(
    'image/svg+xml',
    new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 7"></svg>'),
  );
  assertEquals({ width: svg.width, height: svg.height, hasTransparency: svg.hasTransparency }, {
    width: 12,
    height: 7,
    hasTransparency: null,
  });
  assertMatch(svg.sha256, /^[a-f0-9]{64}$/);
});

Deno.test('returns null metadata for truncated or zero-dimension headers', async () => {
  const truncated = await inspectVerifiedImage('image/jpeg', jpeg1x1.slice(0, 8));
  const zeroSizeGif = await inspectVerifiedImage('image/gif', new Uint8Array([
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x00, 0x00,
    0x01, 0x00, 0x00, 0x00, 0x00,
  ]));

  assertEquals(
    { width: truncated.width, height: truncated.height, hasTransparency: truncated.hasTransparency },
    { width: null, height: null, hasTransparency: null },
  );
  assertEquals(
    { width: zeroSizeGif.width, height: zeroSizeGif.height, hasTransparency: zeroSizeGif.hasTransparency },
    { width: null, height: null, hasTransparency: null },
  );
});

Deno.test('rejects percentage SVG dimensions without a valid viewBox', async () => {
  const result = await inspectVerifiedImage(
    'image/svg+xml',
    new TextEncoder().encode('<svg width="100%" height="50%"></svg>'),
  );

  assertEquals(
    { width: result.width, height: result.height, hasTransparency: result.hasTransparency },
    { width: null, height: null, hasTransparency: null },
  );
});

Deno.test('hashes identical bytes deterministically', async () => {
  const bytes = new TextEncoder().encode('<svg width="3" height="2"></svg>');

  const [first, second] = await Promise.all([
    inspectVerifiedImage('image/svg+xml', bytes),
    inspectVerifiedImage('image/svg+xml', bytes.slice()),
  ]);

  assertEquals(first.sha256, second.sha256);
});
