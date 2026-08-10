import { assertEquals, assertRejects } from "@std/assert";
import { decode, encode } from "fast-png";
import { composeBackground } from "./background-compositor.ts";
import { validatePng } from "./png.ts";
import type { NormalizedTileAtlas } from "./types.ts";
import { PixelLabMapError } from "./types.ts";

type Color = [number, number, number, number];

async function atlas(colors: Color[], tileWidth = 2, tileHeight = 2) {
  const width = colors.length * tileWidth;
  const data = new Uint8Array(width * tileHeight * 4);
  colors.forEach((color, tileIndex) => {
    for (let y = 0; y < tileHeight; y += 1) {
      for (let x = 0; x < tileWidth; x += 1) {
        data.set(color, (y * width + tileIndex * tileWidth + x) * 4);
      }
    }
  });
  return validatePng(encode({ width, height: tileHeight, data, channels: 4, depth: 8 }), {});
}

function manifest(masks: number[], tileWidth = 2, tileHeight = 2): NormalizedTileAtlas {
  return {
    schemaVersion: 1,
    tileWidth,
    tileHeight,
    columns: masks.length,
    rows: 1,
    tiles: masks.map((connectivityMask, index) => ({
      key: `mask-${connectivityMask}`,
      connectivityMask,
      sourceX: index * tileWidth,
      sourceY: 0,
      sourceWidth: tileWidth,
      sourceHeight: tileHeight,
    })),
  };
}

function pixel(bytes: Uint8Array, x: number, y: number): number[] {
  const image = decode(bytes);
  const offset = (y * image.width + x) * image.channels;
  return Array.from(image.data.slice(offset, offset + 4), Number);
}

Deno.test("composes exact pixels for a 2x2 turning-mask fixture deterministically", async () => {
  const masks = [1, 2, 5, 12];
  const colors: Color[] = [
    [220, 20, 20, 255],
    [20, 220, 20, 255],
    [20, 20, 220, 255],
    [220, 220, 20, 255],
  ];
  const source = await atlas(colors);
  const input = {
    width: 4,
    height: 4,
    tileSize: 2,
    cells: masks.map((connectivityMask, index) => ({
      x: index % 2,
      y: Math.floor(index / 2),
      assetKey: "road",
      connectivityMask,
    })),
    atlases: { road: { png: source, manifest: manifest(masks) } },
  };

  const first = await composeBackground(input);
  const second = await composeBackground(input);

  assertEquals(pixel(first.bytes, 0, 0), colors[0]);
  assertEquals(pixel(first.bytes, 3, 0), colors[1]);
  assertEquals(pixel(first.bytes, 0, 3), colors[2]);
  assertEquals(pixel(first.bytes, 3, 3), colors[3]);
  assertEquals(first.bytes, second.bytes);
  assertEquals(first.sha256, second.sha256);
});

Deno.test("uses nearest-neighbor sampling when source and map tile sizes differ", async () => {
  const colors: Color[] = [
    [255, 0, 0, 255],
    [0, 255, 0, 255],
    [0, 0, 255, 255],
    [255, 255, 0, 255],
  ];
  const data = new Uint8Array(colors.flat());
  const source = await validatePng(encode({ width: 2, height: 2, data, channels: 4, depth: 8 }), {});
  const result = await composeBackground({
    width: 4,
    height: 4,
    tileSize: 4,
    cells: [{ x: 0, y: 0, assetKey: "ground", connectivityMask: 0 }],
    atlases: { ground: { png: source, manifest: manifest([0], 2, 2) } },
  });

  assertEquals(pixel(result.bytes, 0, 0), colors[0]);
  assertEquals(pixel(result.bytes, 3, 0), colors[1]);
  assertEquals(pixel(result.bytes, 0, 3), colors[2]);
  assertEquals(pixel(result.bytes, 3, 3), colors[3]);
});

Deno.test("rejects a missing connectivity mask and malformed atlas grid", async () => {
  const source = await atlas([[10, 20, 30, 255], [30, 20, 10, 255]]);
  const base = {
    width: 2,
    height: 2,
    tileSize: 2,
    cells: [{ x: 0, y: 0, assetKey: "ground", connectivityMask: 12 }],
  };
  const missing = await assertRejects(() => composeBackground({
    ...base,
    atlases: { ground: { png: source, manifest: manifest([1, 2]) } },
  }), PixelLabMapError);
  assertEquals(missing.code, "background_composition_failed");

  const malformed = manifest([1, 2]);
  malformed.columns = 1;
  await assertRejects(() => composeBackground({
    ...base,
    cells: [{ ...base.cells[0], connectivityMask: 1 }],
    atlases: { ground: { png: source, manifest: malformed } },
  }), PixelLabMapError);
});
