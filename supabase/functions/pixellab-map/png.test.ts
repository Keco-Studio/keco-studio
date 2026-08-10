import { assertEquals, assertRejects } from "@std/assert";
import { encode } from "fast-png";
import { pngExpectationForAsset, validatePng } from "./png.ts";
import { PixelLabMapError } from "./types.ts";

function rgbaPng(width = 2, height = 2, alpha = true): Uint8Array {
  const data = new Uint8Array(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    data.set([index * 30 + 10, index * 20 + 15, index * 10 + 20, alpha && index === 0 ? 0 : 255], index * 4);
  }
  return encode({ width, height, data, channels: 4, depth: 8 });
}

Deno.test("validates decoded dimensions, transparency, grid alignment, and hash", async () => {
  const result = await validatePng(rgbaPng(4, 4), { width: 4, height: 4, tileSize: 2, alpha: "required" });
  assertEquals(result.width, 4);
  assertEquals(result.height, 4);
  assertEquals(result.hasTransparency, true);
  assertEquals(result.sha256.length, 64);
  assertEquals(result.alphaBounds, { x: 0, y: 0, width: 4, height: 4 });
  assertEquals(result.visiblePixelCount, 15);
  assertEquals(result.opaquePixelCount, 15);
  assertEquals(result.opaqueFillRatio, 15 / 16);
});

Deno.test("ignores alpha fringe at the collision-metric visibility threshold", async () => {
  const data = new Uint8Array(3 * 2 * 4);
  data.set([200, 10, 10, 16], 0);
  data.set([10, 200, 10, 255], (3 + 1) * 4);
  data.set([10, 10, 200, 255], (3 + 2) * 4);
  const bytes = encode({ width: 3, height: 2, data, channels: 4, depth: 8 });

  const result = await validatePng(bytes, { alpha: "required" });

  assertEquals(result.alphaBounds, { x: 1, y: 1, width: 2, height: 1 });
  assertEquals(result.visiblePixelCount, 2);
  assertEquals(result.opaquePixelCount, 2);
  assertEquals(result.opaqueFillRatio, 1);
});

Deno.test("rejects non-PNG, truncation, dimensions, grid, and alpha mismatches", async () => {
  const valid = rgbaPng(4, 4);
  const cases: Array<[Uint8Array, Parameters<typeof validatePng>[1]]> = [
    [new Uint8Array([1, 2, 3]), {}],
    [valid.slice(0, 30), {}],
    [valid, { width: 8 }],
    [valid, { tileSize: 3 }],
    [valid, { alpha: "forbidden" }],
    [rgbaPng(4, 4, false), { alpha: "required" }],
  ];
  for (const [bytes, expectation] of cases) {
    await assertRejects(() => validatePng(bytes, expectation), PixelLabMapError);
  }
});

Deno.test("rejects all-transparent and flat blank images", async () => {
  const transparent = encode({ width: 2, height: 2, data: new Uint8Array(16), channels: 4, depth: 8 });
  const flatData = new Uint8Array(16).fill(255);
  const flat = encode({ width: 2, height: 2, data: flatData, channels: 4, depth: 8 });
  await assertRejects(() => validatePng(transparent, {}), PixelLabMapError);
  await assertRejects(() => validatePng(flat, {}), PixelLabMapError);
});

Deno.test("requires road overlays and objects to be transparent while terrain stays opaque", () => {
  assertEquals(pngExpectationForAsset("terrain", { tile_size: { width: 32, height: 32 } }), {
    tileSize: 32,
    alpha: "forbidden",
  });
  assertEquals(pngExpectationForAsset("road", { tile_size: 32 }), {
    tileSize: 32,
    alpha: "required",
  });
  assertEquals(pngExpectationForAsset("object", { width: 64, height: 80 }), {
    width: 64,
    height: 80,
    alpha: "required",
  });
});
