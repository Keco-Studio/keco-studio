import { decode, encode } from "fast-png";
import { MAX_PNG_BYTES } from "./png.ts";
import { providerAtlasReferences, providerTextBlocks, providerTileReferences } from "./provider-response.ts";
import type { DiscoveredCapability, NormalizedTileAtlas } from "./types.ts";
import { PixelLabMapError } from "./types.ts";

export type AtlasTileSource = {
  key: string;
  connectivityMask: number;
  rotationQuarterTurns?: number;
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
const MAX_METADATA_BYTES = 2 * 1024 * 1024;

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
  const wangName = key?.match(/^wang[_-](\d{1,2})$/i);
  const directMask = numberField(record, ["connectivityMask", "connectivity_mask", "mask", "wangIndex", "wang_index"]);
  const connectivityMask = directMask ?? (wangName ? Number(wangName[1]) : undefined);
  if (!key || connectivityMask == null) return null;
  const url = stringField(record, ["url", "image_url", "imageUrl", "download", "storage_url", "png_url"]);
  const base64 = stringField(record, ["base64", "data"]);
  const bounds = asRecord(record.bounding_box) ?? asRecord(record.boundingBox);
  const sourceX = numberField(record, ["sourceX", "source_x", "x"]) ?? (bounds ? numberField(bounds, ["x"]) : undefined);
  const sourceY = numberField(record, ["sourceY", "source_y", "y"]) ?? (bounds ? numberField(bounds, ["y"]) : undefined);
  const sourceWidth = numberField(record, ["sourceWidth", "source_width", "width"]) ?? (bounds ? numberField(bounds, ["width"]) : undefined);
  const sourceHeight = numberField(record, ["sourceHeight", "source_height", "height"]) ?? (bounds ? numberField(bounds, ["height"]) : undefined);
  return {
    key,
    connectivityMask,
    ...(url ? { url } : {}),
    ...(base64 ? { base64 } : {}),
    ...(sourceX != null ? { sourceX } : {}),
    ...(sourceY != null ? { sourceY } : {}),
    ...(sourceWidth != null ? { sourceWidth } : {}),
    ...(sourceHeight != null ? { sourceHeight } : {}),
  };
}

function extractTileSources(result: Record<string, unknown>): { tiles: AtlasTileSource[]; atlasUrl?: string; atlasBase64?: string } {
  const tiles: AtlasTileSource[] = [];
  let atlasUrl: string | undefined;
  let atlasBase64: string | undefined;
  walk(result, (record) => {
    const tile = tileFromRecord(record);
    if (tile) tiles.push(tile);
    const candidateUrl = stringField(record, ["atlas_url", "atlasUrl", "atlas_download", "spritesheet_url", "tileset_image"]);
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

async function readExternalMetadata(url: string, fetcher: ImageFetcher): Promise<Record<string, unknown>> {
  const response = await fetcher(secureProviderUrl(url));
  if (!response.ok) incomplete("Provider atlas metadata could not be downloaded");
  const declaredValue = response.headers.get("content-length");
  if (declaredValue != null) {
    const declared = Number(declaredValue);
    if (!Number.isFinite(declared) || declared < 0 || declared > MAX_METADATA_BYTES) {
      incomplete("Provider atlas metadata size is invalid");
    }
  }
  if (!response.body) incomplete("Provider atlas metadata is empty");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_METADATA_BYTES) {
      await reader.cancel();
      incomplete("Provider atlas metadata size is invalid");
    }
    chunks.push(value);
  }
  if (size === 0) incomplete("Provider atlas metadata is empty");
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    incomplete("Provider atlas metadata is invalid JSON");
  }
}

async function completeProviderResult(
  result: Record<string, unknown>,
  fetcher: ImageFetcher,
): Promise<Record<string, unknown>> {
  const references = providerAtlasReferences(result);
  if (!references.metadataUrl) return result;
  const metadata = await readExternalMetadata(references.metadataUrl, fetcher);
  const canonicalMetadata = asRecord(metadata.tileset_data)
    ? { tileset_data: metadata.tileset_data }
    : metadata;
  return {
    providerResult: result,
    providerMetadata: canonicalMetadata,
    ...(references.imageUrl ? { atlas_url: references.imageUrl } : {}),
  };
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

function rotateConnectivityMask(mask: number, quarterTurns: number): number {
  const turns = ((quarterTurns % 4) + 4) % 4;
  return ((mask << turns) | (mask >> (4 - turns))) & 15;
}

function selectMaskVariations(
  tiles: AtlasTileSource[],
  requiredMasks: number[],
  synthesizeRotations: boolean,
): AtlasTileSource[] {
  const masks = new Set(tiles.map((tile) => tile.connectivityMask));
  const invalidMask = tiles.find((tile) => !Number.isInteger(tile.connectivityMask) || tile.connectivityMask < 0 || tile.connectivityMask > 15);
  if (invalidMask) incomplete(`Invalid connectivity mask for ${invalidMask.key}`);
  const invalidRequiredMask = requiredMasks.find((mask) => !Number.isInteger(mask) || mask < 0 || mask > 15);
  if (invalidRequiredMask != null) incomplete(`Invalid required connectivity mask: ${invalidRequiredMask}`);
  const selected = [...masks]
    .sort((left, right) => left - right)
    .map((mask) => [...tiles]
      .filter((tile) => tile.connectivityMask === mask)
      .sort((left, right) => left.key.localeCompare(right.key))[0]);
  const providerSelected = [...selected];
  const missing = requiredMasks.filter((mask) => !masks.has(mask));
  if (synthesizeRotations) {
    for (const mask of missing) {
      const rotated = providerSelected
        .flatMap((tile) => [1, 2, 3].map((quarterTurns) => ({ tile, quarterTurns })))
        .filter(({ tile, quarterTurns }) => rotateConnectivityMask(tile.connectivityMask, quarterTurns) === mask)
        .sort((left, right) => left.quarterTurns - right.quarterTurns || left.tile.key.localeCompare(right.tile.key))[0];
      if (!rotated) continue;
      selected.push({
        ...rotated.tile,
        key: `${rotated.tile.key}-rot${rotated.quarterTurns}-${mask}`,
        connectivityMask: mask,
        rotationQuarterTurns: rotated.quarterTurns,
      });
      masks.add(mask);
    }
  }
  const unresolved = requiredMasks.filter((mask) => !masks.has(mask));
  if (unresolved.length) incomplete(`Missing connectivity masks: ${unresolved.join(",")}`);
  return selected;
}

function cropImage(
  image: DecodedImage,
  sourceX: number,
  sourceY: number,
  width: number,
  height: number,
): DecodedImage {
  const rgba = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    const sourceStart = ((sourceY + row) * image.width + sourceX) * 4;
    rgba.set(image.rgba.slice(sourceStart, sourceStart + width * 4), row * width * 4);
  }
  return { width, height, rgba };
}

function rotateImage(image: DecodedImage, quarterTurns = 0): DecodedImage {
  let current = image;
  const turns = ((quarterTurns % 4) + 4) % 4;
  for (let turn = 0; turn < turns; turn += 1) {
    const width = current.height;
    const height = current.width;
    const rgba = new Uint8Array(width * height * 4);
    for (let y = 0; y < current.height; y += 1) {
      for (let x = 0; x < current.width; x += 1) {
        const targetX = current.height - 1 - y;
        const targetY = x;
        const sourceOffset = (y * current.width + x) * 4;
        const targetOffset = (targetY * width + targetX) * 4;
        rgba.set(current.rgba.slice(sourceOffset, sourceOffset + 4), targetOffset);
      }
    }
    current = { width, height, rgba };
  }
  return current;
}

function packImages(tiles: AtlasTileSource[], images: DecodedImage[]): NormalizedAtlas {
  const tileWidth = images[0].width;
  const tileHeight = images[0].height;
  if (tileWidth <= 0 || tileHeight <= 0 || images.some((image) => image.width !== tileWidth || image.height !== tileHeight)) {
    incomplete("Atlas tiles do not share dimensions");
  }
  const ordered = [...tiles].sort((left, right) => left.connectivityMask - right.connectivityMask || left.key.localeCompare(right.key));
  const imageByKey = new Map(tiles.map((tile, index) => [`${tile.key}:${tile.connectivityMask}`, images[index]]));
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
  const completeResult = await completeProviderResult(result, fetcher);
  const extracted = extractTileSources(completeResult);
  if (extracted.tiles.length === 0) incomplete("Provider result contains no tile manifest");
  const selectedTiles = selectMaskVariations(
    extracted.tiles,
    requiredMasks,
    capability.semantic === "path_tiles",
  );

  const hasRectangles = selectedTiles.every((tile) =>
    tile.sourceX != null && tile.sourceY != null && tile.sourceWidth != null && tile.sourceHeight != null
  );
  const hasIndividualImages = selectedTiles.every((tile) => Boolean(tile.url || tile.base64));
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
    const manifestTiles = selectedTiles.map((tile) => ({ ...tile }));
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
      const duplicateRotationSource = (tile.rotationQuarterTurns ?? 0) > 0 && occupied.some((other) =>
        x === other.x && y === other.y && width === other.width && height === other.height
      );
      if (!duplicateRotationSource && occupied.some((other) =>
        x < other.x + other.width && x + width > other.x && y < other.y + other.height && y + height > other.y
      )) {
        incomplete(`Atlas source rectangles overlap for ${tile.key}`);
      }
      occupied.push({ x, y, width, height });
    });
    if (manifestTiles.some((tile) => (tile.rotationQuarterTurns ?? 0) > 0)) {
      const images = manifestTiles.map((tile) => rotateImage(cropImage(
        decoded,
        tile.sourceX as number,
        tile.sourceY as number,
        tile.sourceWidth as number,
        tile.sourceHeight as number,
      ), tile.rotationQuarterTurns));
      return packImages(manifestTiles, images);
    }
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

  const images = await Promise.all(selectedTiles.map(async (tile) =>
    rotateImage(await fetchImage(tile, fetcher), tile.rotationQuarterTurns)
  ));
  return packImages(selectedTiles, images);
}
