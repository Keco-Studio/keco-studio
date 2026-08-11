import { assertEquals, assertRejects } from "@std/assert";
import type { SupabaseClient } from "@supabase/supabase-js";
import { encode } from "fast-png";
import type { AuthorizedAsset } from "./auth.ts";
import {
  canonicalPlanFingerprint,
  composeAndPersistBackground,
  compositionPlanFromMapPlan,
} from "./background-storage.ts";
import { validatePng } from "./png.ts";
import { PixelLabMapError } from "./types.ts";

const IDS = {
  project: "11111111-1111-4111-8111-111111111111",
  map: "22222222-2222-4222-8222-222222222222",
  revision: "33333333-3333-4333-8333-333333333333",
  generation: "44444444-4444-4444-8444-444444444444",
  source: "55555555-5555-4555-8555-555555555555",
  background: "66666666-6666-4666-8666-666666666666",
};

function mapPlan() {
  return {
    schemaVersion: 2,
    name: "Tiny road",
    map: { width: 4, height: 2, tileSize: 2, projection: "top-down" },
    background: { baseTerrainKey: "ground", regions: [], paths: [] },
  };
}

function turningPlan() {
  return {
    schemaVersion: 2,
    map: { width: 4, height: 4, tileSize: 2 },
    background: {
      baseTerrainKey: "ground",
      regions: [],
      paths: [{ assetKey: "road", width: 2, zIndex: 1, points: [
        { x: 1, y: 1 }, { x: 3, y: 1 }, { x: 3, y: 3 },
      ] }],
    },
  };
}

function atlasBytes(left: [number, number, number, number], right: [number, number, number, number]) {
  const data = new Uint8Array(4 * 2 * 4);
  for (let y = 0; y < 2; y += 1) {
    for (let x = 0; x < 4; x += 1) data.set(x < 2 ? left : right, (y * 4 + x) * 4);
  }
  return encode({ width: 4, height: 2, data, channels: 4, depth: 8 });
}

async function fixture(downloadedSource?: Uint8Array) {
  const plan = mapPlan();
  const plannedSource = atlasBytes([180, 50, 50, 255], [50, 180, 50, 255]);
  const validated = await validatePng(plannedSource, {});
  const sourcePath = "private/source.png";
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const objects = new Map<string, Uint8Array>([[sourcePath, downloadedSource ?? plannedSource]]);
  const sourceRow = {
    id: IDS.source,
    map_revision_id: IDS.revision,
    generation_id: IDS.generation,
    asset_key: "ground",
    kind: "terrain",
    status: "ready",
    storage_path: sourcePath,
    sha256: validated.sha256,
    metadata: {
      normalizedTileAtlas: {
        schemaVersion: 1,
        tileWidth: 4,
        tileHeight: 2,
        columns: 1,
        rows: 1,
        tiles: [
          { key: "fill", connectivityMask: 15, sourceX: 0, sourceY: 0, sourceWidth: 4, sourceHeight: 2 },
        ],
      },
    },
  };
  const bucket = {
    async upload(path: string, body: Uint8Array) {
      const copy = new Uint8Array(body.byteLength);
      copy.set(body);
      objects.set(path, copy);
      calls.push({ name: "upload", args: { path } });
      return { data: { path }, error: null };
    },
    async download(path: string) {
      calls.push({ name: "download", args: { path } });
      const bytes = objects.get(path);
      if (!bytes) return { data: null, error: { message: "missing" } };
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      return { data: new Blob([copy]), error: null };
    },
  };
  const client = {
    from() {
      return {
        select() {
          return { async in() { return { data: [sourceRow], error: null }; } };
        },
      };
    },
    storage: { from() { return bucket; } },
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      return { data: [{ status: args.p_next_status }], error: null };
    },
  } as unknown as SupabaseClient;
  const fingerprint = await canonicalPlanFingerprint(plan);
  const authorized = {
    userClient: client,
    serviceClient: client,
    userId: "user",
    projectId: IDS.project,
    mapId: IDS.map,
    revisionId: IDS.revision,
    schemaVersion: 2,
    generationId: IDS.generation,
    revisionPlan: plan,
    asset: {
      id: IDS.background,
      asset_key: "background",
      kind: "background",
      status: "planned",
      requested_capability: null,
      generation_params: { width: 4, height: 2, tileSize: 2, compositorVersion: 1 },
      plan_fingerprint: fingerprint,
      reference_asset_ids: [IDS.source],
      reference_hashes: [validated.sha256],
    },
  } satisfies AuthorizedAsset;
  return { authorized, calls, fingerprint };
}

Deno.test("rasterizes the immutable V2 Plan with turning connectivity", () => {
  const composition = compositionPlanFromMapPlan(turningPlan());
  assertEquals(composition.cells.find((cell) => cell.x === 1 && cell.y === 0), {
    x: 1,
    y: 0,
    layers: [
      { assetKey: "ground", connectivityMask: 15 },
      { assetKey: "road", connectivityMask: 12 },
    ],
  });
});

Deno.test("rasterizes diagonal paths as a one-tile four-connected centerline", () => {
  const plan = {
    schemaVersion: 2,
    map: { width: 8, height: 8, tileSize: 2 },
    background: {
      baseTerrainKey: "ground",
      regions: [],
      paths: [{
        assetKey: "road",
        width: 6,
        zIndex: 1,
        points: [{ x: 1, y: 1 }, { x: 7, y: 7 }],
      }],
    },
  };

  const composition = compositionPlanFromMapPlan(plan);
  const pathCells = composition.cells.filter((cell) => cell.layers.length > 1);
  const keys = new Set(pathCells.map((cell) => `${cell.x}:${cell.y}`));
  const pending = [pathCells[0]];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const cell = pending.pop();
    if (!cell) continue;
    const key = `${cell.x}:${cell.y}`;
    if (visited.has(key)) continue;
    visited.add(key);
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const neighbor = `${cell.x + dx}:${cell.y + dy}`;
      if (!visited.has(neighbor)) {
        const next = pathCells.find((candidate) => `${candidate.x}:${candidate.y}` === neighbor);
        if (next) pending.push(next);
      }
    }
  }

  assertEquals(visited.size, pathCells.length);
  assertEquals(pathCells.length, 7);
});

Deno.test("repeats the complete bridge deck mask across a diagonal bridge", () => {
  const plan = {
    schemaVersion: 2,
    map: { width: 8, height: 8, tileSize: 2 },
    background: {
      baseTerrainKey: "ground",
      regions: [],
      paths: [{
        assetKey: "bridge",
        name: "Wooden bridge",
        prompt: "Wooden bridge deck over water",
        width: 6,
        zIndex: 1,
        points: [{ x: 1, y: 1 }, { x: 7, y: 7 }],
      }],
    },
  };
  const composition = compositionPlanFromMapPlan(plan);
  const bridgeCells = composition.cells.filter((cell) => cell.layers.length > 1);
  assertEquals(bridgeCells.length > 0, true);
  assertEquals(bridgeCells.every((cell) => cell.layers.at(-1)?.connectivityMask === 15), true);
});

Deno.test("canonical Plan fingerprints ignore object key insertion order", async () => {
  assertEquals(
    await canonicalPlanFingerprint({ b: 2, nested: { y: 2, x: 1 }, a: 1 }),
    await canonicalPlanFingerprint({ a: 1, nested: { x: 1, y: 2 }, b: 2 }),
  );
});

Deno.test("binds ordered source hashes and persists a verified locked background", async () => {
  const { authorized, calls, fingerprint } = await fixture();
  const result = await composeAndPersistBackground(authorized);

  assertEquals(result.status, "ready");
  const transitions = calls.filter((call) => call.name === "transition_map_asset");
  assertEquals(transitions.map((call) => call.args.p_next_status), ["queued", "generating", "ready"]);
  assertEquals(transitions[2].args.p_metadata, {
    sourceRevisionId: IDS.revision,
    sourceAssetIds: [IDS.source],
    sourceHashes: [authorized.asset.reference_hashes[0]],
    planFingerprint: fingerprint,
    compositorVersion: "create-map-background-v1",
    outputSha256: (transitions[2].args.p_sha256 as string),
    verifiedReadBack: true,
    alphaBounds: { x: 0, y: 0, width: 4, height: 2 },
    opaquePixelCount: 8,
    visiblePixelCount: 8,
    opaqueFillRatio: 1,
  });
});

Deno.test("rejects a changed source hash and leaves the background retryable", async () => {
  const changed = atlasBytes([20, 30, 200, 255], [200, 30, 20, 255]);
  const { authorized, calls } = await fixture(changed);

  const error = await assertRejects(() => composeAndPersistBackground(authorized), PixelLabMapError);

  assertEquals(error.code, "background_source_mismatch");
  const transitions = calls.filter((call) => call.name === "transition_map_asset");
  assertEquals(transitions.map((call) => [call.args.p_next_status, call.args.p_last_error_code]), [
    ["queued", null],
    ["generating", null],
    ["failed", "background_source_mismatch"],
  ]);
});

Deno.test("retries composition from failed without regenerating source assets", async () => {
  const { authorized, calls } = await fixture();
  authorized.asset.status = "failed";

  await composeAndPersistBackground(authorized);

  const transitions = calls.filter((call) => call.name === "transition_map_asset");
  assertEquals(transitions[0].args.p_expected_status, "failed");
  assertEquals(transitions.map((call) => call.args.p_next_status), ["queued", "generating", "ready"]);
});
