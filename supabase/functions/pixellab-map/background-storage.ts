import type { SupabaseClient } from "@supabase/supabase-js";
import {
  BACKGROUND_COMPOSITOR_VERSION,
  composeBackground,
  type BackgroundComposeInput,
} from "./background-compositor.ts";
import type { AuthorizedAsset } from "./auth.ts";
import { validatePng } from "./png.ts";
import { downloadPrivateAsset, persistValidatedAsset } from "./storage.ts";
import type { NormalizedTileAtlas } from "./types.ts";
import { PixelLabMapError } from "./types.ts";

type SourceAssetRow = {
  id: string;
  map_revision_id: string;
  generation_id: string | null;
  asset_key: string;
  kind: string;
  status: string;
  storage_path: string | null;
  sha256: string | null;
  metadata: Record<string, unknown>;
};

type CompositionPlan = {
  width: number;
  height: number;
  tileSize: number;
  cells: BackgroundComposeInput["cells"];
};

type Point = { x: number; y: number };

function mismatch(message: string): never {
  throw new PixelLabMapError("background_source_mismatch", message, 409);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) mismatch("Map Plan is invalid");
  return value as Record<string, unknown>;
}

function points(value: unknown, minimum: number): Point[] {
  if (!Array.isArray(value) || value.length < minimum) mismatch("Map Plan geometry is invalid");
  return value.map((entry) => {
    const point = asRecord(entry);
    if (typeof point.x !== "number" || !Number.isFinite(point.x) || typeof point.y !== "number" || !Number.isFinite(point.y)) {
      mismatch("Map Plan geometry is invalid");
    }
    return { x: point.x, y: point.y };
  });
}

function pointInPolygon(point: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const current = polygon[index];
    const prior = polygon[previous];
    const crosses = (current.y > point.y) !== (prior.y > point.y) &&
      point.x < ((prior.x - current.x) * (point.y - current.y)) / (prior.y - current.y) + current.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function distanceToSegment(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const ratio = Math.max(0, Math.min(1,
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy),
  ));
  return Math.hypot(point.x - (start.x + ratio * dx), point.y - (start.y + ratio * dy));
}

function pathDistance(point: Point, path: Point[]): number {
  let distance = Number.POSITIVE_INFINITY;
  for (let index = 1; index < path.length; index += 1) {
    distance = Math.min(distance, distanceToSegment(point, path[index - 1], path[index]));
  }
  return distance;
}

function connectivityMask(grid: string[][], x: number, y: number, key: string): number {
  let mask = 0;
  if (grid[y - 1]?.[x] === key) mask |= 1;
  if (grid[y]?.[x + 1] === key) mask |= 2;
  if (grid[y + 1]?.[x] === key) mask |= 4;
  if (grid[y]?.[x - 1] === key) mask |= 8;
  return mask;
}

export function compositionPlanFromMapPlan(value: unknown): CompositionPlan {
  const plan = asRecord(value);
  const map = asRecord(plan.map);
  const background = asRecord(plan.background);
  const width = map.width;
  const height = map.height;
  const tileSize = map.tileSize;
  if (
    plan.schemaVersion !== 2 || !Number.isInteger(width) || !Number.isInteger(height) ||
    !Number.isInteger(tileSize) || Number(width) <= 0 || Number(height) <= 0 || Number(tileSize) <= 0 ||
    Number(width) % Number(tileSize) !== 0 || Number(height) % Number(tileSize) !== 0 ||
    typeof background.baseTerrainKey !== "string" || !background.baseTerrainKey
  ) {
    mismatch("Map Plan dimensions are invalid");
  }
  const columns = Number(width) / Number(tileSize);
  const rows = Number(height) / Number(tileSize);
  const grid = Array.from({ length: rows }, () =>
    Array.from({ length: columns }, () => background.baseTerrainKey as string)
  );

  if (!Array.isArray(background.regions) || !Array.isArray(background.paths)) mismatch("Map Plan background is invalid");
  for (const regionValue of background.regions) {
    const region = asRecord(regionValue);
    if (typeof region.terrainKey !== "string" || !region.terrainKey) mismatch("Map Plan region is invalid");
    const polygon = points(region.points, 3);
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < columns; x += 1) {
        const center = { x: (x + 0.5) * Number(tileSize), y: (y + 0.5) * Number(tileSize) };
        if (pointInPolygon(center, polygon)) grid[y][x] = region.terrainKey;
      }
    }
  }

  background.paths
    .map((value, index) => ({ value: asRecord(value), index }))
    .sort((left, right) => {
      const leftZ = Number(left.value.zIndex);
      const rightZ = Number(right.value.zIndex);
      if (!Number.isFinite(leftZ) || !Number.isFinite(rightZ)) mismatch("Map Plan path z-index is invalid");
      return leftZ - rightZ || left.index - right.index;
    })
    .forEach(({ value: path }) => {
      if (typeof path.assetKey !== "string" || !path.assetKey || typeof path.width !== "number" || path.width <= 0) {
        mismatch("Map Plan path is invalid");
      }
      const centerline = points(path.points, 2);
      for (let y = 0; y < rows; y += 1) {
        for (let x = 0; x < columns; x += 1) {
          const center = { x: (x + 0.5) * Number(tileSize), y: (y + 0.5) * Number(tileSize) };
          if (pathDistance(center, centerline) <= path.width / 2) grid[y][x] = path.assetKey;
        }
      }
    });

  const cells: CompositionPlan["cells"] = [];
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      const assetKey = grid[y][x];
      cells.push({ x, y, assetKey, connectivityMask: connectivityMask(grid, x, y, assetKey) });
    }
  }
  return { width: Number(width), height: Number(height), tileSize: Number(tileSize), cells };
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export async function canonicalPlanFingerprint(plan: unknown): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical(plan)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function atlasManifest(value: unknown): NormalizedTileAtlas {
  const manifest = asRecord(value);
  if (
    manifest.schemaVersion !== 1 || !Number.isInteger(manifest.tileWidth) || !Number.isInteger(manifest.tileHeight) ||
    !Number.isInteger(manifest.columns) || !Number.isInteger(manifest.rows) ||
    Number(manifest.tileWidth) <= 0 || Number(manifest.tileHeight) <= 0 ||
    Number(manifest.columns) <= 0 || Number(manifest.rows) <= 0 || !Array.isArray(manifest.tiles)
  ) mismatch("Source atlas manifest is invalid");
  const tiles = manifest.tiles.map((value) => {
    const tile = asRecord(value);
    if (
      typeof tile.key !== "string" || !tile.key || !Number.isInteger(tile.connectivityMask) ||
      !Number.isInteger(tile.sourceX) || !Number.isInteger(tile.sourceY) ||
      !Number.isInteger(tile.sourceWidth) || !Number.isInteger(tile.sourceHeight)
    ) mismatch("Source atlas tile is invalid");
    return {
      key: tile.key,
      connectivityMask: Number(tile.connectivityMask),
      sourceX: Number(tile.sourceX),
      sourceY: Number(tile.sourceY),
      sourceWidth: Number(tile.sourceWidth),
      sourceHeight: Number(tile.sourceHeight),
    };
  });
  return {
    schemaVersion: 1,
    tileWidth: Number(manifest.tileWidth),
    tileHeight: Number(manifest.tileHeight),
    columns: Number(manifest.columns),
    rows: Number(manifest.rows),
    tiles,
  };
}

async function transition(
  serviceClient: SupabaseClient,
  assetId: string,
  expected: string,
  next: string,
  errorCode: string | null = null,
): Promise<void> {
  const { data, error } = await serviceClient.rpc("transition_map_asset", {
    p_asset_id: assetId,
    p_expected_status: expected,
    p_next_status: next,
    p_provider_operation: null,
    p_provider_transport: null,
    p_provider_job_id: null,
    p_last_error_code: errorCode,
    p_storage_path: null,
    p_sha256: null,
    p_width: null,
    p_height: null,
    p_has_transparency: null,
    p_metadata: {},
  });
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row || row.status !== next) {
    throw new PixelLabMapError("pixellab_upstream", "Could not transition background asset", 409);
  }
}

async function sourceRows(authorized: AuthorizedAsset): Promise<SourceAssetRow[]> {
  const ids = Array.isArray(authorized.asset.reference_asset_ids)
    ? authorized.asset.reference_asset_ids.filter((value): value is string => typeof value === "string")
    : [];
  const hashes = Array.isArray(authorized.asset.reference_hashes)
    ? authorized.asset.reference_hashes.filter((value): value is string => typeof value === "string")
    : [];
  if (ids.length === 0 || ids.length !== hashes.length) mismatch("Background source bindings are incomplete");
  const { data, error } = await authorized.serviceClient.from("map_assets")
    .select("id, map_revision_id, generation_id, asset_key, kind, status, storage_path, sha256, metadata")
    .in("id", ids);
  if (error || !Array.isArray(data) || data.length !== ids.length) mismatch("Background source assets are missing");
  const byId = new Map(data.map((row) => [String(row.id), row as SourceAssetRow]));
  return ids.map((id, index) => {
    const row = byId.get(id);
    if (
      !row || row.map_revision_id !== authorized.revisionId || row.generation_id !== authorized.generationId ||
      !["terrain", "path"].includes(row.kind) || row.status !== "ready" ||
      typeof row.storage_path !== "string" || row.sha256 !== hashes[index]
    ) mismatch(`Background source binding is invalid for ${id}`);
    return row;
  });
}

export async function composeAndPersistBackground(authorized: AuthorizedAsset) {
  if (authorized.schemaVersion !== 2 || authorized.asset.kind !== "background") {
    mismatch("Asset is not a V2 background");
  }
  if (authorized.asset.status !== "planned" && authorized.asset.status !== "failed") {
    mismatch("Background asset is not composable");
  }
  const planFingerprint = await canonicalPlanFingerprint(authorized.revisionPlan);
  if (authorized.asset.plan_fingerprint !== planFingerprint) mismatch("Background Plan fingerprint does not match");
  const plan = compositionPlanFromMapPlan(authorized.revisionPlan);
  const params = asRecord(authorized.asset.generation_params);
  if (
    authorized.asset.requested_capability != null ||
    params.width !== plan.width || params.height !== plan.height || params.tileSize !== plan.tileSize ||
    params.compositorVersion !== 1
  ) {
    mismatch("Background composition parameters do not match the Plan");
  }
  const sources = await sourceRows(authorized);
  const sourceByKey = new Map(sources.map((source) => [source.asset_key, source]));
  for (const key of new Set(plan.cells.map((cell) => cell.assetKey))) {
    if (!sourceByKey.has(key)) mismatch(`Background source is missing for ${key}`);
  }

  const initialStatus = String(authorized.asset.status);
  await transition(authorized.serviceClient, String(authorized.asset.id), initialStatus, "queued");
  await transition(authorized.serviceClient, String(authorized.asset.id), "queued", "generating");
  let persistenceStarted = false;
  try {
    const atlases: BackgroundComposeInput["atlases"] = {};
    for (const source of sources) {
      const bytes = await downloadPrivateAsset(authorized.serviceClient, source.storage_path as string);
      const png = await validatePng(bytes, {});
      if (png.sha256 !== source.sha256) mismatch(`Background source hash changed for ${source.asset_key}`);
      const metadata = asRecord(source.metadata);
      atlases[source.asset_key] = {
        png,
        manifest: atlasManifest(metadata.normalizedTileAtlas),
      };
    }
    const png = await composeBackground({ ...plan, atlases });
    persistenceStarted = true;
    const ready = await persistValidatedAsset(
      {
        serviceClient: authorized.serviceClient,
        projectId: authorized.projectId,
        mapId: authorized.mapId,
        revisionId: authorized.revisionId,
      },
      {
        id: String(authorized.asset.id),
        assetKey: String(authorized.asset.asset_key),
        expectedStatus: "generating",
        metadata: {
          sourceRevisionId: authorized.revisionId,
          sourceAssetIds: sources.map((source) => source.id),
          sourceHashes: sources.map((source) => source.sha256),
          planFingerprint,
          compositorVersion: BACKGROUND_COMPOSITOR_VERSION,
          outputSha256: png.sha256,
        },
      },
      png,
    );
    return { assetId: String(authorized.asset.id), status: "ready" as const, ready };
  } catch (error) {
    if (!persistenceStarted) {
      await transition(
        authorized.serviceClient,
        String(authorized.asset.id),
        "generating",
        "failed",
        error instanceof PixelLabMapError ? error.code : "background_composition_failed",
      );
    }
    throw error;
  }
}
