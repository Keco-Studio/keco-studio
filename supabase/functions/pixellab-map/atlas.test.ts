import { assertEquals, assertRejects } from "@std/assert";
import { encode } from "fast-png";
import { normalizeTileAtlas } from "./atlas.ts";
import type { DiscoveredCapability } from "./types.ts";
import { PixelLabMapError } from "./types.ts";

const capability: DiscoveredCapability = {
  semantic: "path_tiles",
  transport: "mcp",
  operation: "live_path_tool",
  schemaFingerprint: "f".repeat(64),
  inputSchema: {},
};

const terrainCapability: DiscoveredCapability = {
  ...capability,
  semantic: "topdown_tileset",
  operation: "live_terrain_tool",
};

function tilePng(color: [number, number, number, number]): Uint8Array {
  return encode({ width: 2, height: 2, data: new Uint8Array([...color, ...color, ...color, ...color]), channels: 4, depth: 8 });
}

function fetcherFor(images: Record<string, Uint8Array>) {
  return async (input: RequestInfo | URL) => {
    const source = images[String(input)];
    const bytes = new Uint8Array(source.byteLength);
    bytes.set(source);
    return new Response(bytes.buffer);
  };
}

Deno.test("packs every returned path tile into stable connectivity order", async () => {
  const result = {
    content: [{ type: "text", text: [
      "placement_rules:",
      "  tile-east: mask=2",
      "  tile-north: mask=1",
      "storage_urls:",
      "  tile-east: https://cdn.example/east.png",
      "  tile-north: https://cdn.example/north.png",
    ].join("\n") }],
  };
  const normalized = await normalizeTileAtlas(result, capability, fetcherFor({
    "https://cdn.example/east.png": tilePng([255, 0, 0, 255]),
    "https://cdn.example/north.png": tilePng([0, 255, 0, 255]),
  }), [1, 2]);

  assertEquals(normalized.manifest.tiles.map((tile) => [tile.key, tile.connectivityMask, tile.sourceX]), [
    ["tile-north", 1, 0],
    ["tile-east", 2, 2],
  ]);
  assertEquals(normalized.manifest.columns, 2);
  assertEquals(normalized.manifest.rows, 1);
});

Deno.test("preserves a complete atlas image when source rectangles are provided", async () => {
  const atlasData = new Uint8Array(4 * 2 * 4);
  for (let y = 0; y < 2; y += 1) {
    for (let x = 0; x < 4; x += 1) {
      atlasData.set(x < 2 ? [255, 0, 0, 255] : [0, 255, 0, 255], (y * 4 + x) * 4);
    }
  }
  const atlas = encode({
    width: 4,
    height: 2,
    data: atlasData,
    channels: 4,
    depth: 8,
  });
  const normalized = await normalizeTileAtlas({
    atlas_base64: `data:image/png;base64,${btoa(String.fromCharCode(...atlas))}`,
    tiles: [
      { key: "north", mask: 1, x: 0, y: 0, width: 2, height: 2 },
      { key: "east", mask: 2, x: 2, y: 0, width: 2, height: 2 },
    ],
  }, capability, fetcherFor({}), [1, 2]);

  assertEquals(normalized.bytes, atlas);
  assertEquals(normalized.manifest.tiles[1].sourceX, 2);
});

Deno.test("normalizes a captured-shaped terrain atlas JSON text result", async () => {
  const atlas = tilePng([20, 90, 35, 255]);
  const result = {
    content: [{
      type: "text",
      text: JSON.stringify({
        atlas_url: "https://cdn.example/terrain-atlas.png",
        tiles: [{ key: "grass-isolated", connectivity_mask: 0, source_x: 0, source_y: 0, source_width: 2, source_height: 2 }],
      }),
    }],
  };
  const normalized = await normalizeTileAtlas(result, terrainCapability, fetcherFor({
    "https://cdn.example/terrain-atlas.png": atlas,
  }), [0]);

  assertEquals(normalized.manifest, {
    schemaVersion: 1,
    tileWidth: 2,
    tileHeight: 2,
    columns: 1,
    rows: 1,
    tiles: [{
      key: "grass-isolated",
      connectivityMask: 0,
      sourceX: 0,
      sourceY: 0,
      sourceWidth: 2,
      sourceHeight: 2,
    }],
  });
});

Deno.test("blocks duplicate or missing masks instead of selecting a generic tile", async () => {
  const result = { tiles: [
    { key: "a", mask: 1, base64: `data:image/png;base64,${btoa(String.fromCharCode(...tilePng([1, 2, 3, 255])))}` },
    { key: "b", mask: 1, base64: `data:image/png;base64,${btoa(String.fromCharCode(...tilePng([4, 5, 6, 255])))}` },
  ] };
  await assertRejects(() => normalizeTileAtlas(result, capability, fetcherFor({}), [1, 2]), PixelLabMapError);
});

Deno.test("blocks exact duplicate manifest entries instead of deduplicating them", async () => {
  const image = `data:image/png;base64,${btoa(String.fromCharCode(...tilePng([1, 2, 3, 255])))}`;
  const error = await assertRejects(() => normalizeTileAtlas({
    tiles: [
      { key: "north", mask: 1, base64: image },
      { key: "north", mask: 1, base64: image },
    ],
  }, capability, fetcherFor({}), [1]), PixelLabMapError);

  assertEquals(error.code, "atlas_manifest_incomplete");
  assertEquals(error.message, "Duplicate connectivity mask: 1");
});

Deno.test("rejects insecure atlas URLs before fetching", async () => {
  let fetchCount = 0;
  const error = await assertRejects(() => normalizeTileAtlas({
    tiles: [{ key: "north", mask: 1, url: "http://cdn.example/north.png" }],
  }, capability, async () => {
    fetchCount += 1;
    const source = tilePng([1, 2, 3, 255]);
    const body = new Uint8Array(source.byteLength);
    body.set(source);
    return new Response(body.buffer);
  }, [1]), PixelLabMapError);

  assertEquals(error.code, "atlas_manifest_incomplete");
  assertEquals(fetchCount, 0);
});

Deno.test("rejects oversized atlas downloads from declared length", async () => {
  const error = await assertRejects(() => normalizeTileAtlas({
    tiles: [{ key: "north", mask: 1, url: "https://cdn.example/north.png" }],
  }, capability, async () => new Response(new Uint8Array([1]), {
    headers: { "content-length": String(10 * 1024 * 1024 + 1) },
  }), [1]), PixelLabMapError);

  assertEquals(error.code, "atlas_manifest_incomplete");
  assertEquals(error.message, "Atlas image size is invalid");
});

Deno.test("blocks atlas manifests with missing source rectangles", async () => {
  await assertRejects(() => normalizeTileAtlas({
    atlas_base64: `data:image/png;base64,${btoa(String.fromCharCode(...tilePng([1, 2, 3, 255])))}`,
    tiles: [{ key: "north", mask: 1 }],
  }, capability, fetcherFor({}), [1]), PixelLabMapError);
});
