import { decode, encode } from "fast-png";
import { MAX_PNG_BYTES } from "./png.ts";
import { providerTextBlocks, providerTileReferences } from "./provider-response.ts";
import type { DiscoveredCapability, NormalizedTileAtlas } from "./types.ts";
import { PixelLabMapError } from "./types.ts";

export type AtlasTileSource = {
  key: string;
  connectivityMask: number;
  url?: string;
  base64?: string;
  sourceX?: number;
  sourceY?: number;
  sourceWidth?: number;
  sourceHeight?: number;
};

export type NormalizedAtlas = {
  bytes: Uint8Array;
  manifest: NormalizedTileAtlas;
};

type DecodedImage = {
  width: number;
  height: number;
  rgba: Uint8Array;
};

type ImageFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const MAX_BASE64_LENGTH = Math.ceil(MAX_PNG_BYTES / 3) * 4 + 4;

function incomplete(message: string): never {
  throw new PixelLabMapError("atlas_manifest_incomplete", message, 422);
}

function decodeBase64(value: string): Uint8Array {
  const encoded = value.replace(/^data:image\/png;base64,/, "");
  if (encoded.length === 0 || encoded.length > MAX_BASE64_LENGTH) {
    incomplete("Atlas image size is invalid");
  }
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
  } catch {
    incomplete("Atlas tile contains invalid base64");
  }
  if (bytes.byteLength > MAX_PNG_BYTES) incomplete("Atlas image size is invalid");
  return bytes;
}

function secureProviderUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    incomplete("Atlas image URL is invalid");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    incomplete("Atlas image URL must use HTTPS without credentials");
  }
  return url.toString();
}

async function readProviderBytes(response: Response, message: string): Promise<Uint8Array> {
  const declaredValue = response.headers.get("content-length");
  if (declaredValue != null) {
    const declared = Number(declaredValue);
    if (!Number.isFinite(declared) || declared < 0 || declared > MAX_PNG_BYTES) {
      incomplete("Atlas image size is invalid");
    }
  }
  if (!response.body) incomplete(message);

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_PNG_BYTES) {
      await reader.cancel();
      incomplete("Atlas image size is invalid");
    }
    chunks.push(value);
  }
  if (size === 0) incomplete(message);
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function numberField(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  }
  return undefined;
}

function stringField(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    if (typeof record[key] === "string" && record[key]) return record[key] as string;
  }
  return undefined;
}

function parseTextJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return value;
  try { return JSON.parse(trimmed); } catch { return value; }
}

function walk(value: unknown, visit: (record: Record<string, unknown>) => void): void {
  const parsed = parseTextJson(value);
  if (Array.isArray(parsed)) {
    parsed.forEach((entry) => walk(entry, visit));
    return;
  }
  const record = asRecord(parsed);
  if (!record) return;
  visit(record);
  Object.values(record).forEach((entry) => walk(entry, visit));
}

function tileFromRecord(record: Record<string, unknown>): AtlasTileSource | null {
  const key = stringField(record, ["key", "tile_key", "tileKey", "name", "id"]);
  const connectivityMask = numberField(record, ["connectivityMask", "connectivity_mask", "mask", "wangIndex", "wang_index"]);
  if (!key || connectivityMask == null) return null;
  const url = stringField(record, ["url", "image_url", "imageUrl", "download", "storage_url", "png_url"]);
  const base64 = stringField(record, ["base64", "data"]);
  return {
    key,
    connectivityMask,
    ...(url ? { url } : {}),
    ...(base64 ? { base64 } : {}),
    ...(numberField(record, ["sourceX", "source_x", "x"]) != null ? { sourceX: numberField(record, ["sourceX", "source_x", "x"]) } : {}),
    ...(numberField(record, ["sourceY", "source_y", "y"]) != null ? { sourceY: numberField(record, ["sourceY", "source_y", "y"]) } : {}),
    ...(numberField(record, ["sourceWidth", "source_width", "width"]) != null ? { sourceWidth: numberField(record, ["sourceWidth", "source_width", "width"]) } : {}),
    ...(numberField(record, ["sourceHeight", "source_height", "height"]) != null ? { sourceHeight: numberField(record, ["sourceHeight", "source_height", "height"]) } : {}),
  };
}

function extractTileSources(result: Record<string, unknown>): { tiles: AtlasTileSource[]; atlasUrl?: string; atlasBase64?: string } {
  const tiles: AtlasTileSource[] = [];
  let atlasUrl: string | undefined;
  let atlasBase64: string | undefined;
  walk(result, (record) => {
    const tile = tileFromRecord(record);
    if (tile) tiles.push(tile);
    const candidateUrl = stringField(record, ["atlas_url", "atlasUrl", "atlas_download", "spritesheet_url"]);
    if (candidateUrl) atlasUrl = candidateUrl;
    const candidateBase64 = stringField(record, ["atlas_base64", "atlasBase64"]);
    if (candidateBase64) atlasBase64 = candidateBase64;
  });

  providerTileReferences(result).forEach((reference) => tiles.push({
    key: reference.key,
    connectivityMask: reference.connectivityMask,
    ...(reference.url.startsWith("data:image/png;base64,")
      ? { base64: reference.url }
      : { url: reference.url }),
  }));
  for (const block of providerTextBlocks(result)) {
    for (const line of block.split(/\r?\n/)) {
      const atlas = line.match(/^\s*(?:atlas|download|image_url)\s*:\s*(https:\/\/\S+|data:image\/png;base64,\S+)\s*$/i);
      if (atlas?.[1]?.startsWith("data:image/png;base64,")) atlasBase64 ??= atlas[1];
      else if (atlas) atlasUrl ??= atlas[1];
    }
  }

  return { tiles, ...(atlasUrl ? { atlasUrl } : {}), ...(atlasBase64 ? { atlasBase64 } : {}) };
}

function rgbaImage(image: ReturnType<typeof decode>): DecodedImage {
  const channels = image.channels;
  const max = image.depth === 16 ? 65535 : 255;
  const rgba = new Uint8Array(image.width * image.height * 4);
  for (let index = 0; index < image.width * image.height; index += 1) {
    const sourceOffset = index * channels;
    const targetOffset = index * 4;
    const value = (channel: number) => Math.round(Number(image.data[sourceOffset + channel]) * 255 / max);
    if (channels === 1 || channels === 2) {
      rgba[targetOffset] = value(0);
      rgba[targetOffset + 1] = value(0);
      rgba[targetOffset + 2] = value(0);
      rgba[targetOffset + 3] = channels === 2 ? value(1) : 255;
    } else {
      rgba[targetOffset] = value(0);
      rgba[targetOffset + 1] = value(1);
      rgba[targetOffset + 2] = value(2);
      rgba[targetOffset + 3] = channels >= 4 ? value(3) : 255;
    }
  }
  return { width: image.width, height: image.height, rgba };
}

async function fetchImage(source: AtlasTileSource, fetcher: ImageFetcher): Promise<DecodedImage> {
  let bytes: Uint8Array | null = source.base64 ? decodeBase64(source.base64) : null;
  if (!bytes && source.url) {
    const response = await fetcher(secureProviderUrl(source.url));
    if (!response.ok) incomplete(`Atlas tile ${source.key} could not be downloaded`);
    bytes = await readProviderBytes(response, `Atlas tile ${source.key} is empty`);
  }
  if (!bytes) incomplete(`Atlas tile ${source.key} is missing image bytes`);
  try { return rgbaImage(decode(bytes)); } catch { incomplete(`Atlas tile ${source.key} is not a valid PNG`); }
}

function assertMaskRequirements(tiles: AtlasTileSource[], requiredMasks: number[]): void {
  const masks = new Set(tiles.map((tile) => tile.connectivityMask));
  const invalidMask = tiles.find((tile) => !Number.isInteger(tile.connectivityMask) || tile.connectivityMask < 0 || tile.connectivityMask > 15);
  if (invalidMask) incomplete(`Invalid connectivity mask for ${invalidMask.key}`);
  const duplicateMask = [...masks].find((mask) => tiles.filter((tile) => tile.connectivityMask === mask).length > 1);
  if (duplicateMask != null) incomplete(`Duplicate connectivity mask: ${duplicateMask}`);
  const keys = new Set(tiles.map((tile) => tile.key));
  const duplicateKey = [...keys].find((key) => tiles.filter((tile) => tile.key === key).length > 1);
  if (duplicateKey != null) incomplete(`Duplicate atlas tile key: ${duplicateKey}`);
  const invalidRequiredMask = requiredMasks.find((mask) => !Number.isInteger(mask) || mask < 0 || mask > 15);
  if (invalidRequiredMask != null) incomplete(`Invalid required connectivity mask: ${invalidRequiredMask}`);
  const missing = requiredMasks.filter((mask) => !masks.has(mask));
  if (missing.length) incomplete(`Missing connectivity masks: ${missing.join(",")}`);
}

function atlasManifest(tiles: AtlasTileSource[], tileWidth: number, tileHeight: number): NormalizedTileAtlas {
  const ordered = [...tiles].sort((left, right) => left.connectivityMask - right.connectivityMask || left.key.localeCompare(right.key));
  return {
    schemaVersion: 1,
    tileWidth,
    tileHeight,
    columns: ordered.length,
    rows: 1,
    tiles: ordered.map((tile, index) => ({
      key: tile.key,
      connectivityMask: tile.connectivityMask,
      sourceX: index * tileWidth,
      sourceY: 0,
      sourceWidth: tileWidth,
      sourceHeight: tileHeight,
    })),
  };
}

export async function normalizeTileAtlas(
  result: Record<string, unknown>,
  capability: DiscoveredCapability,
  fetcher: ImageFetcher,
  requiredMasks: number[] = [],
): Promise<NormalizedAtlas> {
  if (capability.semantic !== "topdown_tileset" && capability.semantic !== "path_tiles") {
    incomplete("Only terrain and path capabilities can produce a tile atlas");
  }
  const extracted = extractTileSources(result);
  if (extracted.tiles.length === 0) incomplete("Provider result contains no tile manifest");
  assertMaskRequirements(extracted.tiles, requiredMasks);

  const hasRectangles = extracted.tiles.every((tile) =>
    tile.sourceX != null && tile.sourceY != null && tile.sourceWidth != null && tile.sourceHeight != null
  );
  const hasIndividualImages = extracted.tiles.every((tile) => Boolean(tile.url || tile.base64));
  if ((extracted.atlasUrl || extracted.atlasBase64) && !hasIndividualImages) {
    if (!hasRectangles) incomplete("Atlas image is missing source rectangles");
    let atlasBytes: Uint8Array;
    if (extracted.atlasBase64) {
      atlasBytes = decodeBase64(extracted.atlasBase64);
    } else {
      const response = await fetcher(secureProviderUrl(extracted.atlasUrl as string));
      if (!response.ok) incomplete("Provider atlas could not be downloaded");
      atlasBytes = await readProviderBytes(response, "Provider atlas is empty");
    }
    let decoded: DecodedImage;
    try { decoded = rgbaImage(decode(atlasBytes)); } catch { incomplete("Provider atlas is not a valid PNG"); }
    const manifestTiles = extracted.tiles.map((tile) => ({ ...tile }));
    const first = manifestTiles[0];
    const tileWidth = first.sourceWidth as number;
    const tileHeight = first.sourceHeight as number;
    if (tileWidth <= 0 || tileHeight <= 0) incomplete("Atlas source rectangle is invalid");
    if (decoded.width % tileWidth !== 0 || decoded.height % tileHeight !== 0) {
      incomplete("Provider atlas dimensions do not align to its tile grid");
    }
    const occupied: Array<{ x: number; y: number; width: number; height: number }> = [];
    manifestTiles.forEach((tile) => {
      const x = tile.sourceX as number;
      const y = tile.sourceY as number;
      const width = tile.sourceWidth as number;
      const height = tile.sourceHeight as number;
      if (
        ![x, y, width, height].every(Number.isInteger) ||
        width !== tileWidth ||
        height !== tileHeight ||
        x < 0 ||
        y < 0 ||
        x % tileWidth !== 0 ||
        y % tileHeight !== 0 ||
        x + width > decoded.width ||
        y + height > decoded.height
      ) {
        incomplete(`Atlas source rectangle is invalid for ${tile.key}`);
      }
      if (occupied.some((other) => x < other.x + other.width && x + width > other.x && y < other.y + other.height && y + height > other.y)) {
        incomplete(`Atlas source rectangles overlap for ${tile.key}`);
      }
      occupied.push({ x, y, width, height });
    });
    const manifest = {
      ...atlasManifest(manifestTiles, tileWidth, tileHeight),
      tiles: [...manifestTiles].sort((left, right) => left.connectivityMask - right.connectivityMask || left.key.localeCompare(right.key)).map((tile) => ({
        key: tile.key,
        connectivityMask: tile.connectivityMask,
        sourceX: tile.sourceX as number,
        sourceY: tile.sourceY as number,
        sourceWidth: tile.sourceWidth as number,
        sourceHeight: tile.sourceHeight as number,
      })),
      columns: decoded.width / tileWidth,
      rows: decoded.height / tileHeight,
    };
    return { bytes: atlasBytes, manifest };
  }

  const images = await Promise.all(extracted.tiles.map((tile) => fetchImage(tile, fetcher)));
  const tileWidth = images[0].width;
  const tileHeight = images[0].height;
  if (tileWidth <= 0 || tileHeight <= 0 || images.some((image) => image.width !== tileWidth || image.height !== tileHeight)) {
    incomplete("Atlas tiles do not share dimensions");
  }
  const ordered = [...extracted.tiles].sort((left, right) => left.connectivityMask - right.connectivityMask || left.key.localeCompare(right.key));
  const imageByKey = new Map(extracted.tiles.map((tile, index) => [`${tile.key}:${tile.connectivityMask}`, images[index]]));
  const rgba = new Uint8Array(ordered.length * tileWidth * tileHeight * 4);
  ordered.forEach((tile, tileIndex) => {
    const image = imageByKey.get(`${tile.key}:${tile.connectivityMask}`);
    if (!image) incomplete(`Missing decoded image for ${tile.key}`);
    for (let row = 0; row < tileHeight; row += 1) {
      const sourceStart = row * tileWidth * 4;
      const targetStart = (row * ordered.length * tileWidth + tileIndex * tileWidth) * 4;
      rgba.set(image.rgba.slice(sourceStart, sourceStart + tileWidth * 4), targetStart);
    }
  });
  const manifest = atlasManifest(ordered, tileWidth, tileHeight);
  const bytes = encode({ width: ordered.length * tileWidth, height: tileHeight, data: rgba, channels: 4, depth: 8 });
  if (bytes.byteLength > MAX_PNG_BYTES) incomplete("Normalized atlas size is invalid");
  return { bytes, manifest };
}
