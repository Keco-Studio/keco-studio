import { assertEquals, assertNotStrictEquals, assertThrows } from "@std/assert";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  assertGenerationIdentity,
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
