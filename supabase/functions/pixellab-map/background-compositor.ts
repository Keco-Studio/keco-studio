import { decode, encode } from "fast-png";
import { validatePng, type ValidatedPng } from "./png.ts";
import type { NormalizedTileAtlas } from "./types.ts";
import { PixelLabMapError } from "./types.ts";

export const BACKGROUND_COMPOSITOR_VERSION = "create-map-background-v1";

export type BackgroundComposeInput = {
  width: number;
  height: number;
  tileSize: number;
  cells: Array<{ x: number; y: number; assetKey: string; connectivityMask: number }>;
  atlases: Record<string, { png: ValidatedPng; manifest: NormalizedTileAtlas }>;
};

type DecodedRgba = { width: number; height: number; data: Uint8Array };

function invalid(message: string): never {
  throw new PixelLabMapError("background_composition_failed", message, 422);
}

function decodeRgba(png: ValidatedPng): DecodedRgba {
  let image: ReturnType<typeof decode>;
  try {
    image = decode(png.bytes);
  } catch {
    invalid("Background source atlas is not a valid PNG");
  }
  if (image.width !== png.width || image.height !== png.height) {
    invalid("Background source dimensions changed after validation");
  }
  const channels = image.channels;
  const max = image.depth === 16 ? 65535 : 255;
  const data = new Uint8Array(image.width * image.height * 4);
  for (let index = 0; index < image.width * image.height; index += 1) {
    const source = index * channels;
    const target = index * 4;
    const channel = (offset: number) => Math.round(Number(image.data[source + offset]) * 255 / max);
    if (channels === 1 || channels === 2) {
      data[target] = channel(0);
      data[target + 1] = channel(0);
      data[target + 2] = channel(0);
      data[target + 3] = channels === 2 ? channel(1) : 255;
    } else {
      data[target] = channel(0);
      data[target + 1] = channel(1);
      data[target + 2] = channel(2);
      data[target + 3] = channels >= 4 ? channel(3) : 255;
    }
  }
  return { width: image.width, height: image.height, data };
}

function validateInput(input: BackgroundComposeInput): { columns: number; rows: number } {
  if (
    !Number.isInteger(input.width) || !Number.isInteger(input.height) ||
    !Number.isInteger(input.tileSize) || input.width <= 0 || input.height <= 0 || input.tileSize <= 0 ||
    input.width % input.tileSize !== 0 || input.height % input.tileSize !== 0
  ) {
    invalid("Background dimensions do not align to the tile grid");
  }
  const columns = input.width / input.tileSize;
  const rows = input.height / input.tileSize;
  if (input.cells.length !== columns * rows) invalid("Background cells do not cover the map");
  const coordinates = new Set<string>();
  for (const cell of input.cells) {
    if (
      !Number.isInteger(cell.x) || !Number.isInteger(cell.y) ||
      cell.x < 0 || cell.y < 0 || cell.x >= columns || cell.y >= rows ||
      typeof cell.assetKey !== "string" || !cell.assetKey ||
      !Number.isInteger(cell.connectivityMask) || cell.connectivityMask < 0 || cell.connectivityMask > 15
    ) {
      invalid("Background contains an invalid cell");
    }
    const key = `${cell.x}:${cell.y}`;
    if (coordinates.has(key)) invalid("Background contains duplicate cells");
    coordinates.add(key);
  }
  return { columns, rows };
}

function validateAtlas(assetKey: string, image: DecodedRgba, manifest: NormalizedTileAtlas): void {
  if (
    manifest.schemaVersion !== 1 || !Number.isInteger(manifest.tileWidth) || !Number.isInteger(manifest.tileHeight) ||
    !Number.isInteger(manifest.columns) || !Number.isInteger(manifest.rows) ||
    manifest.tileWidth <= 0 || manifest.tileHeight <= 0 || manifest.columns <= 0 || manifest.rows <= 0 ||
    image.width !== manifest.tileWidth * manifest.columns || image.height !== manifest.tileHeight * manifest.rows ||
    manifest.tiles.length === 0
  ) {
    invalid(`Background atlas grid is invalid for ${assetKey}`);
  }
  const masks = new Set<number>();
  const keys = new Set<string>();
  for (const tile of manifest.tiles) {
    if (
      !tile.key || !Number.isInteger(tile.connectivityMask) || tile.connectivityMask < 0 || tile.connectivityMask > 15 ||
      !Number.isInteger(tile.sourceX) || !Number.isInteger(tile.sourceY) ||
      tile.sourceWidth !== manifest.tileWidth || tile.sourceHeight !== manifest.tileHeight ||
      tile.sourceX < 0 || tile.sourceY < 0 ||
      tile.sourceX % manifest.tileWidth !== 0 || tile.sourceY % manifest.tileHeight !== 0 ||
      tile.sourceX + tile.sourceWidth > image.width || tile.sourceY + tile.sourceHeight > image.height ||
      masks.has(tile.connectivityMask) || keys.has(tile.key)
    ) {
      invalid(`Background atlas manifest is invalid for ${assetKey}`);
    }
    masks.add(tile.connectivityMask);
    keys.add(tile.key);
  }
}

export async function composeBackground(input: BackgroundComposeInput): Promise<ValidatedPng> {
  validateInput(input);
  const decoded = new Map<string, DecodedRgba>();
  const output = new Uint8Array(input.width * input.height * 4);

  for (const cell of input.cells) {
    const atlas = input.atlases[cell.assetKey];
    if (!atlas) invalid(`Background atlas is missing for ${cell.assetKey}`);
    let image = decoded.get(cell.assetKey);
    if (!image) {
      image = decodeRgba(atlas.png);
      validateAtlas(cell.assetKey, image, atlas.manifest);
      decoded.set(cell.assetKey, image);
    }
    const tile = atlas.manifest.tiles.find((candidate) =>
      candidate.connectivityMask === cell.connectivityMask
    );
    if (!tile) invalid(`Background atlas ${cell.assetKey} is missing mask ${cell.connectivityMask}`);
    if (
      !Number.isInteger(tile.sourceX) || !Number.isInteger(tile.sourceY) ||
      !Number.isInteger(tile.sourceWidth) || !Number.isInteger(tile.sourceHeight) ||
      tile.sourceX < 0 || tile.sourceY < 0 || tile.sourceWidth <= 0 || tile.sourceHeight <= 0 ||
      tile.sourceX + tile.sourceWidth > image.width || tile.sourceY + tile.sourceHeight > image.height
    ) {
      invalid(`Background atlas rectangle is invalid for ${cell.assetKey}`);
    }

    for (let targetY = 0; targetY < input.tileSize; targetY += 1) {
      const sourceY = tile.sourceY + Math.floor(targetY * tile.sourceHeight / input.tileSize);
      const outputY = cell.y * input.tileSize + targetY;
      for (let targetX = 0; targetX < input.tileSize; targetX += 1) {
        const sourceX = tile.sourceX + Math.floor(targetX * tile.sourceWidth / input.tileSize);
        const sourceOffset = (sourceY * image.width + sourceX) * 4;
        const outputX = cell.x * input.tileSize + targetX;
        const outputOffset = (outputY * input.width + outputX) * 4;
        output.set(image.data.subarray(sourceOffset, sourceOffset + 4), outputOffset);
      }
    }
  }

  const bytes = encode({
    width: input.width,
    height: input.height,
    data: output,
    channels: 4,
    depth: 8,
  });
  return validatePng(bytes, { width: input.width, height: input.height, alpha: "optional" });
}
