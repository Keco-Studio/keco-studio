import { assertEquals, assertRejects } from "@std/assert";
import { encode } from "fast-png";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  finalizePersistedCharacterAsset,
  persistValidatedCharacterAsset,
} from "./storage.ts";
import type { AuthorizedCharacterAttempt } from "./types.ts";

const RESERVATION_ID = "66666666-6666-4666-8666-666666666666";
const state = {
  actorUserId: "11111111-1111-4111-8111-111111111111",
  projectId: "22222222-2222-4222-8222-222222222222",
  assetId: "33333333-3333-4333-8333-333333333333",
  attemptId: "44444444-4444-4444-8444-444444444444",
  generationId: "55555555-5555-4555-8555-555555555555",
  planFingerprint: "a".repeat(64),
  attemptCount: 1,
  status: "generating",
  lastErrorCode: null,
  providerJobId: null,
  metadata: {},
  plan: {
    schemaVersion: 1,
    kind: "character",
    name: "Quota fixture",
    description: "A transparent two-color fixture.",
    perspective: "topdown",
    facing: "front",
    width: 2,
    height: 2,
    transparent: true,
  },
  sourceProviderCharacterId: null,
} satisfies AuthorizedCharacterAttempt;

const bytes = encode({
  width: 2,
  height: 2,
  channels: 4,
  depth: 8,
  data: new Uint8Array([
    255, 0, 0, 255, 0, 255, 0, 255,
    0, 0, 255, 0, 255, 255, 0, 255,
  ]),
});

function fixtureClient(options: { failUpload?: boolean; failFinalize?: boolean } = {}) {
  const calls: Array<{ name: string; args: unknown }> = [];
  const bucket = {
    async upload(path: string) {
      calls.push({ name: "upload", args: path });
      return options.failUpload
        ? { data: null, error: { message: "forced upload failure" } }
        : { data: { path }, error: null };
    },
    async download(path: string) {
      calls.push({ name: "download", args: path });
      const downloaded = new Uint8Array(bytes.byteLength);
      downloaded.set(bytes);
      return options.failUpload
        ? { data: null, error: { message: "not found" } }
        : { data: new Blob([downloaded.buffer]), error: null };
    },
    async remove(paths: string[]) {
      calls.push({ name: "remove", args: paths });
      return { data: paths, error: null };
    },
  };
  const client = {
    storage: { from: () => bucket },
    async rpc(name: string, args: unknown) {
      calls.push({ name, args });
      if (name === "service_reserve_project_storage_upload_v2") {
        return {
          data: {
            reservationId: RESERVATION_ID,
            ownerId: state.actorUserId,
            projectId: state.projectId,
            expectedBytes: 20 * 1024 * 1024,
            reused: false,
          },
          error: null,
        };
      }
      if (name === "service_finalize_project_storage_upload_v2") {
        return options.failFinalize
          ? { data: null, error: { details: "STORAGE_TEMPORARILY_UNAVAILABLE" } }
          : {
            data: {
              fileId: "77777777-7777-4777-8777-777777777777",
              ownerId: state.actorUserId,
              projectId: state.projectId,
              sizeBytes: bytes.byteLength,
              reservationId: RESERVATION_ID,
              reused: false,
            },
            error: null,
          };
      }
      return { data: { reservationId: RESERVATION_ID, reused: false }, error: null };
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

Deno.test("character upload failure releases its reservation", async () => {
  const { client, calls } = fixtureClient({ failUpload: true });
  await assertRejects(() => persistValidatedCharacterAsset(
    client,
    state,
    bytes,
    { width: 2, height: 2, alphaRequired: true },
  ));
  assertEquals(calls.filter((call) => call.name === "service_release_project_storage_upload").length, 1);
});

Deno.test("character finalize failure removes the object and releases its reservation", async () => {
  const { client, calls } = fixtureClient({ failFinalize: true });
  const persisted = await persistValidatedCharacterAsset(
    client,
    state,
    bytes,
    { width: 2, height: 2, alphaRequired: true },
  );
  await assertRejects(() => finalizePersistedCharacterAsset(client, state, persisted));
  assertEquals(calls.filter((call) => call.name === "remove").length, 1);
  assertEquals(calls.filter((call) => call.name === "service_release_project_storage_upload").length, 1);
});
