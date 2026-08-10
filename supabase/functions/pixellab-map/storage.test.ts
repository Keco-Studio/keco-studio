import { assertEquals, assertRejects } from "@std/assert";
import type { SupabaseClient } from "@supabase/supabase-js";
import { persistValidatedAsset } from "./storage.ts";
import type { ValidatedPng } from "./png.ts";
import { PixelLabMapError } from "./types.ts";

const IDs = {
  projectId: "11111111-1111-4111-8111-111111111111",
  mapId: "22222222-2222-4222-8222-222222222222",
  revisionId: "33333333-3333-4333-8333-333333333333",
  assetId: "44444444-4444-4444-8444-444444444444",
};

function fixtureClient(bytes: Uint8Array, failReadBack = false) {
  const calls: Array<{ name: string; args: unknown }> = [];
  let downloadCount = 0;
  const bucket = {
    async upload(path: string, body: Uint8Array, options: unknown) {
      calls.push({ name: "upload", args: { path, body, options } });
      return { data: { path }, error: null };
    },
    async download(path: string) {
      downloadCount += 1;
      calls.push({ name: "download", args: path });
      if (failReadBack) return { data: null, error: { message: "failed" } };
      const downloadedBytes = new Uint8Array(bytes.byteLength);
      downloadedBytes.set(bytes);
      return { data: new Blob([downloadedBytes]), error: null };
    },
  };
  const client = {
    storage: { from(name: string) { calls.push({ name: "bucket", args: name }); return bucket; } },
    async rpc(name: string, args: unknown) {
      calls.push({ name, args });
      return { data: [{ status: "ready" }], error: null };
    },
  } as unknown as SupabaseClient;
  return { client, calls, getDownloadCount: () => downloadCount };
}

const png: ValidatedPng = {
  bytes: new Uint8Array([137, 80, 78, 71]), width: 64, height: 80,
  hasTransparency: true, sha256: "a".repeat(64),
  alphaBounds: { x: 4, y: 6, width: 56, height: 70 },
  opaquePixelCount: 2500,
  visiblePixelCount: 2800,
  opaqueFillRatio: 0.64,
};

Deno.test("uploads privately, reads back exact bytes, then transitions ready", async () => {
  const { client, calls, getDownloadCount } = fixtureClient(png.bytes);
  const result = await persistValidatedAsset(
    { serviceClient: client, projectId: IDs.projectId, mapId: IDs.mapId, revisionId: IDs.revisionId },
    { id: IDs.assetId, assetKey: "oak-tree" }, png,
  );
  const expectedPath = `${IDs.projectId}/${IDs.mapId}/${IDs.revisionId}/oak-tree/${png.sha256}.png`;
  assertEquals(result.storagePath, expectedPath);
  assertEquals(getDownloadCount(), 1);
  assertEquals((calls.find((call) => call.name === "upload")?.args as { options: unknown }).options, {
    contentType: "image/png", cacheControl: "31536000", upsert: false,
  });
  const transition = calls.find((call) => call.name === "transition_map_asset");
  assertEquals((transition?.args as Record<string, unknown>).p_next_status, "ready");
  assertEquals((transition?.args as Record<string, unknown>).p_storage_path, expectedPath);
  assertEquals((transition?.args as Record<string, unknown>).p_metadata, {
    verifiedReadBack: true,
    alphaBounds: png.alphaBounds,
    opaquePixelCount: png.opaquePixelCount,
    visiblePixelCount: png.visiblePixelCount,
    opaqueFillRatio: png.opaqueFillRatio,
  });
});

Deno.test("read-back failure never binds a path and marks storage_failed", async () => {
  const { client, calls } = fixtureClient(png.bytes, true);
  await assertRejects(() => persistValidatedAsset(
    { serviceClient: client, projectId: IDs.projectId, mapId: IDs.mapId, revisionId: IDs.revisionId },
    { id: IDs.assetId, assetKey: "oak-tree" }, png,
  ), PixelLabMapError);
  const transitions = calls.filter((call) => call.name === "transition_map_asset");
  assertEquals(transitions.length, 1);
  assertEquals((transitions[0].args as Record<string, unknown>).p_next_status, "failed");
  assertEquals((transitions[0].args as Record<string, unknown>).p_last_error_code, "storage_failed");
  assertEquals((transitions[0].args as Record<string, unknown>).p_storage_path, null);
});
