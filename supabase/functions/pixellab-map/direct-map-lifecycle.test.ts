import { assertEquals, assertRejects } from "@std/assert";
import { encode } from "fast-png";
import { runDirectMapLifecycle } from "./direct-map-lifecycle.ts";
import { PixelLabMapError, type DiscoveredCapability } from "./types.ts";

const IDS = {
  projectId: "11111111-1111-4111-8111-111111111111",
  mapId: "22222222-2222-4222-8222-222222222222",
  revisionId: "33333333-3333-4333-8333-333333333333",
  generationId: "44444444-4444-4444-8444-444444444444",
  assetId: "55555555-5555-4555-8555-555555555555",
};

const CAPABILITY: DiscoveredCapability = {
  semantic: "direct_map_image",
  transport: "mcp",
  operation: "create_image_pro",
  schemaFingerprint: "a".repeat(64),
  inputSchema: {
    type: "object",
    properties: {
      description: { type: "string" },
      width: { type: "integer" },
      height: { type: "integer" },
      no_background: { type: "boolean" },
    },
    required: ["description", "width", "height", "no_background"],
  },
  pollOperation: "get_image",
  pollSchemaFingerprint: "b".repeat(64),
  pollInputSchema: {
    type: "object",
    properties: { job_id: { type: "string" } },
    required: ["job_id"],
  },
};

function mapPng(transparent = false): Uint8Array {
  const data = new Uint8Array(512 * 512 * 4);
  for (let index = 0; index < 512 * 512; index += 1) {
    data.set([index % 251, Math.floor(index / 512) % 241, (index * 7) % 239, transparent && index === 0 ? 0 : 255], index * 4);
  }
  return encode({ width: 512, height: 512, data, channels: 4, depth: 8 });
}

function authorized(status: string, metadata: Record<string, unknown> = {}) {
  return {
    projectId: IDS.projectId,
    mapId: IDS.mapId,
    revisionId: IDS.revisionId,
    schemaVersion: 3,
    generationId: IDS.generationId,
    serviceClient: {},
    asset: {
      id: IDS.assetId,
      asset_key: "map-image",
      kind: "map_image",
      status,
      requested_capability: "direct_map_image",
      prompt: "Exact final prompt.  Keep spacing.",
      generation_params: { width: 512, height: 512, noBackground: false, seed: null, references: [], styleReference: null },
      reference_asset_ids: [],
      reference_hashes: [],
      provider_operation: status === "generating" ? "create_image_pro" : null,
      provider_job_id: status === "generating" ? "job-1" : null,
      metadata,
    },
  };
}

function harness(options: {
  status?: string;
  providerStatus?: string;
  bytes?: Uint8Array;
  metadata?: Record<string, unknown>;
  submitError?: Error;
  submitResult?: Record<string, unknown>;
  lastErrorCode?: string | null;
  updatedAt?: string;
} = {}) {
  const authorizedAsset = authorized(options.status ?? "generating", options.metadata ?? {
    schemaFingerprint: CAPABILITY.schemaFingerprint,
    pollOperation: CAPABILITY.pollOperation,
    pollSchemaFingerprint: CAPABILITY.pollSchemaFingerprint,
  });
  const transitions: Array<{ from: string; to: string; details: Record<string, unknown> }> = [];
  const submissions: Record<string, unknown>[] = [];
  const polls: string[] = [];
  const persisted: Array<{ asset: Record<string, unknown>; png: { width: number; height: number; hasTransparency: boolean } }> = [];
  let downloads = 0;
  const client = {
    discover: async () => CAPABILITY,
    submitAsset: async (_capability: DiscoveredCapability, args: Record<string, unknown>) => {
      submissions.push(args);
      if (options.submitError) throw options.submitError;
      return options.submitResult ?? { job_id: "job-1" };
    },
    pollJob: async (_capability: DiscoveredCapability, jobId: string) => {
      polls.push(jobId);
      return { status: options.providerStatus ?? "completed", images: ["first", "second"] };
    },
    downloadResult: async () => {
      downloads += 1;
      return options.bytes ?? mapPng();
    },
  };
  return {
    authorized: {
      ...authorizedAsset,
      asset: {
        ...authorizedAsset.asset,
        last_error_code: options.lastErrorCode ?? null,
        updated_at: options.updatedAt ?? "2026-08-11T00:00:00.000Z",
      },
    },
    client,
    transitions,
    submissions,
    polls,
    persisted,
    downloads: () => downloads,
    transitionAsset: async (_client: unknown, _assetId: string, from: string, to: string, details: Record<string, unknown> = {}) => {
      transitions.push({ from, to, details });
    },
    persistAsset: async (_context: unknown, asset: Record<string, unknown>, png: { width: number; height: number; hasTransparency: boolean }) => {
      persisted.push({ asset, png });
      return { assetId: IDS.assetId, storagePath: "private/map.png", sha256: "c".repeat(64), width: png.width, height: png.height, hasTransparency: png.hasTransparency };
    },
  };
}

Deno.test("requires explicit duplicate-billing acknowledgement before resolving a stale queued submission", async () => {
  const state = harness({ status: "queued", updatedAt: "2026-08-11T00:00:00.000Z" });

  const error = await assertRejects(
    () => runDirectMapLifecycle({
      operation: "resolve_unknown",
      acknowledgeDuplicateBilling: false,
      now: () => Date.parse("2026-08-11T00:03:00.000Z"),
      ...state,
    } as never),
    PixelLabMapError,
  );

  assertEquals(error.status, 400);
  assertEquals(state.transitions, []);
  assertEquals(state.submissions, []);
});

Deno.test("durably blocks a stale queued submission after explicit acknowledgement", async () => {
  const state = harness({ status: "queued", updatedAt: "2026-08-11T00:00:00.000Z" });

  const result = await runDirectMapLifecycle({
    operation: "resolve_unknown",
    acknowledgeDuplicateBilling: true,
    now: () => Date.parse("2026-08-11T00:03:00.000Z"),
    ...state,
  } as never);

  assertEquals(result, { assetId: IDS.assetId, status: "blocked" });
  assertEquals(state.transitions, [
    { from: "queued", to: "blocked", details: { errorCode: "pixellab_submit_outcome_unknown" } },
  ]);
  assertEquals(state.submissions, []);
});

Deno.test("does not resolve a queued submission before the safety window elapses", async () => {
  const state = harness({ status: "queued", updatedAt: "2026-08-11T00:00:00.000Z" });

  const error = await assertRejects(
    () => runDirectMapLifecycle({
      operation: "resolve_unknown",
      acknowledgeDuplicateBilling: true,
      now: () => Date.parse("2026-08-11T00:01:59.999Z"),
      ...state,
    } as never),
    PixelLabMapError,
  );

  assertEquals(error.status, 409);
  assertEquals(state.transitions, []);
});

Deno.test("submits the exact description and stores only sanitized capability identity", async () => {
  const state = harness({ status: "planned", metadata: {} });
  const result = await runDirectMapLifecycle({ operation: "submit", ...state } as never);
  assertEquals(result, { assetId: IDS.assetId, status: "generating" });
  assertEquals(state.submissions, [{ description: "Exact final prompt.  Keep spacing.", width: 512, height: 512, no_background: false }]);
  assertEquals(state.transitions, [
    { from: "planned", to: "queued", details: {} },
    { from: "queued", to: "generating", details: {
      operation: "create_image_pro",
      transport: "mcp",
      jobId: "job-1",
      metadata: {
        schemaFingerprint: CAPABILITY.schemaFingerprint,
        pollOperation: "get_image",
        pollSchemaFingerprint: CAPABILITY.pollSchemaFingerprint,
      },
    } },
  ]);
});

Deno.test("blocks an ambiguous paid submission outcome without making it retryable", async () => {
  const state = harness({
    status: "planned",
    metadata: {},
    submitError: new PixelLabMapError("pixellab_upstream"),
  });

  await assertRejects(
    () => runDirectMapLifecycle({ operation: "submit", ...state } as never),
    PixelLabMapError,
  );
  assertEquals(state.submissions.length, 1);
  assertEquals(state.transitions, [
    { from: "planned", to: "queued", details: {} },
    { from: "queued", to: "blocked", details: { errorCode: "pixellab_submit_outcome_unknown" } },
  ]);
});

Deno.test("rejects retry for a blocked asset whose paid submission outcome is unknown", async () => {
  const state = harness({
    status: "blocked",
    lastErrorCode: "pixellab_submit_outcome_unknown",
  });

  const error = await assertRejects(
    () => runDirectMapLifecycle({ operation: "retry", ...state } as never),
    PixelLabMapError,
  );
  assertEquals(error.status, 409);
  assertEquals(state.submissions, []);
  assertEquals(state.transitions, []);
});

Deno.test("rejects retry for a legacy failed submission without a provider job id", async () => {
  const state = harness({ status: "failed", lastErrorCode: "pixellab_upstream" });

  const error = await assertRejects(
    () => runDirectMapLifecycle({ operation: "retry", ...state } as never),
    PixelLabMapError,
  );
  assertEquals(error.status, 409);
  assertEquals(state.submissions, []);
});

Deno.test("keeps an explicit provider rate-limit rejection safely retryable", async () => {
  const state = harness({
    status: "planned",
    metadata: {},
    submitError: new PixelLabMapError("pixellab_rate_limited", undefined, 429),
  });

  await assertRejects(
    () => runDirectMapLifecycle({ operation: "submit", ...state } as never),
    PixelLabMapError,
  );
  assertEquals(state.transitions, [
    { from: "planned", to: "queued", details: {} },
    { from: "queued", to: "blocked", details: { errorCode: "pixellab_rate_limited" } },
  ]);
});

Deno.test("blocks a successful-looking submission that omits the provider job id", async () => {
  const state = harness({ status: "planned", metadata: {}, submitResult: { status: "accepted" } });

  await assertRejects(
    () => runDirectMapLifecycle({ operation: "submit", ...state } as never),
    PixelLabMapError,
  );
  assertEquals(state.transitions, [
    { from: "planned", to: "queued", details: {} },
    { from: "queued", to: "blocked", details: { errorCode: "pixellab_submit_outcome_unknown" } },
  ]);
});

Deno.test("poll reports completed without downloading or storing the map", async () => {
  const state = harness();
  const result = await runDirectMapLifecycle({ operation: "poll", ...state } as never);
  assertEquals(result, { assetId: IDS.assetId, status: "completed" });
  assertEquals(state.polls, ["job-1"]);
  assertEquals(state.downloads(), 0);
  assertEquals(state.persisted, []);
  assertEquals(state.transitions, []);
});

Deno.test("validate downloads candidate zero, verifies it, and persists one ready map", async () => {
  const state = harness();
  const result = await runDirectMapLifecycle({ operation: "validate", ...state } as never);
  assertEquals(result.status, "ready");
  assertEquals(state.downloads(), 1);
  assertEquals(state.persisted.length, 1);
  assertEquals(state.persisted[0].png.width, 512);
  assertEquals(state.persisted[0].png.height, 512);
  assertEquals(state.persisted[0].png.hasTransparency, false);
  assertEquals(state.persisted[0].asset, {
    id: IDS.assetId,
    assetKey: "map-image",
    expectedStatus: "generating",
    metadata: {
      schemaFingerprint: CAPABILITY.schemaFingerprint,
      pollOperation: "get_image",
      pollSchemaFingerprint: CAPABILITY.pollSchemaFingerprint,
      candidateIndex: 0,
    },
  });
});

Deno.test("validate rejects provider work that is not complete", async () => {
  const state = harness({ providerStatus: "processing" });
  const error = await assertRejects(
    () => runDirectMapLifecycle({ operation: "validate", ...state } as never),
    PixelLabMapError,
  );
  assertEquals(error.status, 409);
  assertEquals(state.downloads(), 0);
  assertEquals(state.persisted, []);
});

Deno.test("validation failure marks a transparent map failed without storing it", async () => {
  const state = harness({ bytes: mapPng(true) });
  await assertRejects(() => runDirectMapLifecycle({ operation: "validate", ...state } as never), PixelLabMapError);
  assertEquals(state.persisted, []);
  assertEquals(state.transitions, [{ from: "generating", to: "failed", details: { errorCode: "validation_failed" } }]);
});

Deno.test("a stale capability blocks before polling the provider job", async () => {
  const state = harness({ metadata: {
    schemaFingerprint: "stale",
    pollOperation: "get_image",
    pollSchemaFingerprint: CAPABILITY.pollSchemaFingerprint,
  } });
  await assertRejects(() => runDirectMapLifecycle({ operation: "poll", ...state } as never), PixelLabMapError);
  assertEquals(state.polls, []);
  assertEquals(state.transitions, [{
    from: "generating",
    to: "blocked",
    details: { errorCode: "pixellab_capability_missing" },
  }]);
});
