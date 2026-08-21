import { assertEquals, assertNotStrictEquals, assertThrows } from "@std/assert";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  assertDirectMapPaidOperationAccess,
  assertGenerationIdentity,
  assertRegionObstacleBackgroundBinding,
  createPixelLabClients,
  type PixelLabClientFactory,
} from "./auth.ts";
import { PixelLabMapError } from "./types.ts";

Deno.test("validates a JWT with a header-free auth client and uses one bearer header for RLS", () => {
  const calls: Array<{ url: string; key: string; options: Record<string, unknown> }> = [];
  const factory: PixelLabClientFactory = (url, key, options) => {
    calls.push({ url, key, options });
    return { key } as unknown as SupabaseClient;
  };

  const clients = createPixelLabClients("user-token", factory, {
    url: "http://local",
    anon: "anon",
    service: "service",
  });

  assertEquals(calls.length, 3);
  assertEquals(calls[0], {
    url: "http://local",
    key: "anon",
    options: { auth: { persistSession: false } },
  });
  assertEquals(calls[1], {
    url: "http://local",
    key: "anon",
    options: {
      global: { headers: { authorization: "Bearer user-token" } },
      auth: { persistSession: false },
    },
  });
  assertEquals(calls[2], {
    url: "http://local",
    key: "service",
    options: { auth: { persistSession: false } },
  });
  assertNotStrictEquals(clients.authClient, clients.userClient);
});

Deno.test("requires the complete generation identity for every V2 asset operation", () => {
  const authorized = {
    mapId: "map-a",
    revisionId: "revision-a",
    schemaVersion: 2,
    generationId: "generation-a",
  };

  assertGenerationIdentity(authorized, {
    mapId: "map-a",
    revisionId: "revision-a",
    generationId: "generation-a",
  });
  const error = assertThrows(() => assertGenerationIdentity(authorized, {
    mapId: "map-a",
    revisionId: "revision-a",
    generationId: "generation-b",
  }), PixelLabMapError);
  assertEquals(error.status, 403);
  assertEquals(error.message, "Map generation identity mismatch");
});

Deno.test("keeps legacy assets on their existing identity contract", () => {
  assertGenerationIdentity({
    mapId: "legacy-map",
    revisionId: "legacy-revision",
    schemaVersion: 1,
    generationId: null,
  }, {});
});

Deno.test("allows paid direct-map submission only through a trusted service caller", () => {
  for (const operation of ["submit", "retry"] as const) {
    const userError = assertThrows(() => assertDirectMapPaidOperationAccess(operation, {
      serviceRoleRequest: false,
      gddWorkerRequest: false,
      expectedAttemptCount: 0,
    }), PixelLabMapError);
    assertEquals(userError.status, 403);

    const missingAttemptError = assertThrows(() => assertDirectMapPaidOperationAccess(operation, {
      serviceRoleRequest: true,
      gddWorkerRequest: false,
      expectedAttemptCount: undefined,
    }), PixelLabMapError);
    assertEquals(missingAttemptError.status, 403);

    assertDirectMapPaidOperationAccess(operation, {
      serviceRoleRequest: true,
      gddWorkerRequest: false,
      expectedAttemptCount: 0,
    });
    assertDirectMapPaidOperationAccess(operation, {
      serviceRoleRequest: true,
      gddWorkerRequest: true,
      expectedAttemptCount: undefined,
    });
  }

  for (const operation of ["poll", "validate", "resolve_unknown"] as const) {
    assertDirectMapPaidOperationAccess(operation, {
      serviceRoleRequest: false,
      gddWorkerRequest: false,
      expectedAttemptCount: undefined,
    });
  }
});

Deno.test("requires the exact generation identity for schema 3", () => {
  const authorized = { mapId: "map-v3", revisionId: "revision-v3", schemaVersion: 3, generationId: "generation-v3" };
  assertGenerationIdentity(authorized, { mapId: "map-v3", revisionId: "revision-v3", generationId: "generation-v3" });
  for (const request of [
    { mapId: "stale", revisionId: "revision-v3", generationId: "generation-v3" },
    { mapId: "map-v3", revisionId: "stale", generationId: "generation-v3" },
    { mapId: "map-v3", revisionId: "revision-v3", generationId: null },
  ]) {
    const error = assertThrows(() => assertGenerationIdentity(authorized, request), PixelLabMapError);
    assertEquals(error.status, 403);
  }
});

Deno.test("rejects regional obstacles whose background binding is stale or mismatched", () => {
  const authorized = {
    revisionId: "revision-a",
    generationId: "generation-a",
    revisionPlan: { map: { width: 640, height: 448 } },
    asset: {
      kind: "obstacle",
      metadata: {
        source: "region-generation",
        backgroundAssetId: "background-a",
        backgroundSha256: "a".repeat(64),
      },
      plan_fingerprint: "f".repeat(64),
      reference_asset_ids: ["background-a"],
      reference_hashes: ["a".repeat(64)],
      generation_params: { regionSelection: { x: 10, y: 20, width: 64, height: 48 } },
    },
  };
  assertRegionObstacleBackgroundBinding(authorized, {
    id: "background-a",
    map_revision_id: "revision-a",
    generation_id: "generation-a",
    kind: "background",
    status: "ready",
    sha256: "a".repeat(64),
    plan_fingerprint: "f".repeat(64),
  });
  const error = assertThrows(() => assertRegionObstacleBackgroundBinding(authorized, {
    id: "background-a",
    map_revision_id: "revision-a",
    generation_id: "generation-b",
    kind: "background",
    status: "ready",
    sha256: "a".repeat(64),
    plan_fingerprint: "f".repeat(64),
  }), PixelLabMapError);
  assertEquals(error.status, 403);
});
