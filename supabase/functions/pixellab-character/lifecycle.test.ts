import { assertEquals, assertRejects } from "@std/assert";
import { runCharacterLifecycle } from "./lifecycle.ts";
import { PixelLabCharacterError, type AuthorizedCharacterAttempt, type CharacterCapability } from "./types.ts";

const IDS = {
  projectId: "11111111-1111-4111-8111-111111111111",
  assetId: "22222222-2222-4222-8222-222222222222",
  attemptId: "33333333-3333-4333-8333-333333333333",
  generationId: "44444444-4444-4444-8444-444444444444",
};

const capability: CharacterCapability = {
  semantic: "character", operation: "create_character", pollOperation: "get_character",
  schemaFingerprint: "a".repeat(64), pollSchemaFingerprint: "b".repeat(64),
  inputSchema: {}, pollInputSchema: {},
};

function fixture(overrides: Partial<AuthorizedCharacterAttempt> = {}) {
  const transitions: Array<{ from: string; to: string; details: Record<string, unknown> }> = [];
  const submissions: Record<string, unknown>[] = [];
  const state: AuthorizedCharacterAttempt = {
    projectId: IDS.projectId, assetId: IDS.assetId, attemptId: IDS.attemptId,
    generationId: IDS.generationId, planFingerprint: "c".repeat(64), attemptCount: 0,
    status: "planned", lastErrorCode: null, providerJobId: null, metadata: {},
    plan: {
      schemaVersion: 1, kind: "character", name: "Scout", description: "A forest scout",
      perspective: "topdown", facing: "front", width: 96, height: 96, transparent: true,
    },
    sourceProviderCharacterId: null,
    ...overrides,
  };
  return {
    state, transitions, submissions,
    dependencies: {
      discover: async () => capability,
      submit: async (_capability: CharacterCapability, args: Record<string, unknown>) => {
        submissions.push(args);
        return { structuredContent: { character_id: "provider-character" } } as Record<string, unknown>;
      },
      poll: async (): Promise<Record<string, unknown>> => ({ structuredContent: { status: "processing" } }),
      transition: async (from: string, to: string, details: Record<string, unknown> = {}) => {
        transitions.push({ from, to, details });
      },
      validateAndPersist: async () => ({ status: "ready" as const }),
      now: () => Date.parse("2026-08-27T00:03:00.000Z"),
    },
  };
}

Deno.test("submits one paid character job and persists provider character identity", async () => {
  const test = fixture();
  const result = await runCharacterLifecycle({ operation: "submit", expectedAttemptCount: 0 }, test.state, test.dependencies);

  assertEquals(result, { assetId: IDS.assetId, status: "generating" });
  assertEquals(test.submissions, [{ description: "A forest scout", name: "Scout", mode: "pro", size: 96, view: "high top-down" }]);
  assertEquals(test.transitions, [
    { from: "planned", to: "queued", details: { expectedAttemptCount: 0 } },
    { from: "queued", to: "generating", details: {
      expectedAttemptCount: 1,
      providerOperation: "create_character", providerJobId: "provider-character",
      schemaFingerprint: capability.schemaFingerprint,
      metadata: { providerCharacterId: "provider-character", pollOperation: "get_character", pollSchemaFingerprint: capability.pollSchemaFingerprint },
    } },
  ]);
});

Deno.test("submits V3 animation only from the verified source provider character", async () => {
  const test = fixture({
    plan: {
      schemaVersion: 1, kind: "animation", name: "walk_left",
      sourceCharacterAssetId: IDS.assetId, sourceCharacterSha256: "d".repeat(64),
      motionDescription: "Walk steadily", frameWidth: 96, frameHeight: 96,
      frameCount: 6, fps: 10, loop: true,
    },
    sourceProviderCharacterId: "provider-character",
    sourceFacing: "left",
  });
  test.dependencies.discover = async () => ({ ...capability, semantic: "animation", operation: "animate_character", pollOperation: "get_character" });
  test.dependencies.submit = async (_capability, args) => {
    test.submissions.push(args);
    return { structuredContent: { job_ids: ["animation-job"], animation_group_id: "animation-group" } };
  };

  await runCharacterLifecycle({ operation: "submit", expectedAttemptCount: 0 }, test.state, test.dependencies);

  assertEquals(test.submissions, [{
    character_id: "provider-character", action_description: "Walk steadily", animation_name: "walk_left",
    directions: ["west"], mode: "v3", frame_count: 6, keep_first_frame: false,
  }]);
  assertEquals(test.transitions.at(-1)?.details.providerJobId, "provider-character");
  assertEquals(test.transitions.at(-1)?.details.metadata, {
    providerCharacterId: "provider-character", pollOperation: "get_character",
    pollSchemaFingerprint: capability.pollSchemaFingerprint,
  });
});

Deno.test("blocks an ambiguous paid submission outcome and never automatically resubmits it", async () => {
  const test = fixture();
  test.dependencies.submit = async () => { throw new PixelLabCharacterError("pixellab_upstream"); };

  await assertRejects(
    () => runCharacterLifecycle({ operation: "submit", expectedAttemptCount: 0 }, test.state, test.dependencies),
    PixelLabCharacterError,
  );
  assertEquals(test.transitions.at(-1), {
    from: "queued", to: "blocked", details: { expectedAttemptCount: 1, lastErrorCode: "pixellab_submit_outcome_unknown" },
  });
});

Deno.test("poll only reports completion and validate performs persistence separately", async () => {
  const test = fixture({ status: "generating", providerJobId: "provider-character", metadata: { providerCharacterId: "provider-character" } });
  test.dependencies.poll = async () => ({ structuredContent: {
    status: "completed", character_id: "provider-character",
    rotations: [{ direction: "south", image_url: "https://cdn.example.test/south.png" }],
  } });

  assertEquals(await runCharacterLifecycle({ operation: "poll" }, test.state, test.dependencies), {
    assetId: IDS.assetId, status: "completed",
  });
  assertEquals(test.transitions, []);
  assertEquals(await runCharacterLifecycle({ operation: "validate" }, test.state, test.dependencies), { status: "ready" });
});

Deno.test("does not fail a completed job when character output is not materialized yet", async () => {
  const test = fixture({ status: "generating", providerJobId: "provider-character", metadata: { providerCharacterId: "provider-character" } });
  test.dependencies.poll = async () => ({ structuredContent: {
    status: "completed", character_id: "provider-character",
  } });
  let validations = 0;
  test.dependencies.validateAndPersist = async () => { validations += 1; return { status: "ready" as const }; };

  assertEquals(await runCharacterLifecycle({ operation: "poll" }, test.state, test.dependencies), {
    assetId: IDS.assetId, status: "processing",
  });
  assertEquals(validations, 0);
  assertEquals(test.transitions, []);
});

Deno.test("includes safe diagnostics when animation is completed but output is not materialized", async () => {
  const test = fixture({
    status: "generating", providerJobId: "provider-character", sourceProviderCharacterId: "provider-character", sourceFacing: "left",
    plan: {
      schemaVersion: 1, kind: "animation", name: "walk_left", sourceCharacterAssetId: IDS.assetId,
      sourceCharacterSha256: "d".repeat(64), motionDescription: "Walk steadily", frameWidth: 96,
      frameHeight: 96, frameCount: 6, fps: 10, loop: true,
    },
  });
  test.dependencies.discover = async () => ({ ...capability, semantic: "animation", operation: "animate_character", pollOperation: "get_character" });
  test.dependencies.poll = async () => ({ structuredContent: {
    status: "completed", character_id: "provider-character",
    animations: [{ display_name: "walk_left", directions: [{ direction: "west", status: "completed" }] }],
  } });

  assertEquals(await runCharacterLifecycle({ operation: "poll" }, test.state, test.dependencies), {
    assetId: IDS.assetId, status: "processing",
    providerDiagnostics: {
      keyPaths: [
        "structuredContent", "structuredContent.animations", "structuredContent.animations[].directions",
        "structuredContent.animations[].directions[].direction", "structuredContent.animations[].directions[].status",
        "structuredContent.animations[].display_name", "structuredContent.character_id", "structuredContent.status",
      ],
      textLabels: [], textShapes: [], statusTokens: ["completed"], urlCount: 0,
    },
  });
});

Deno.test("reuses persisted polling capability without rediscovering tools", async () => {
  const test = fixture({
    status: "generating", providerJobId: "provider-character",
    metadata: { providerCharacterId: "provider-character", pollOperation: "get_character", pollSchemaFingerprint: capability.pollSchemaFingerprint },
  });
  let discoveries = 0;
  test.dependencies.discover = async () => { discoveries += 1; return capability; };
  test.dependencies.poll = async () => ({ structuredContent: { status: "processing" } });

  assertEquals(await runCharacterLifecycle({ operation: "poll" }, test.state, test.dependencies), {
    assetId: IDS.assetId, status: "processing",
  });
  assertEquals(discoveries, 0);
});

Deno.test("keeps a generating job retryable when output storage is temporarily unavailable", async () => {
  const test = fixture({ status: "generating", providerJobId: "provider-character", metadata: { providerCharacterId: "provider-character" } });
  test.dependencies.poll = async () => ({ structuredContent: {
    status: "completed", character_id: "provider-character",
    rotations: [{ direction: "south", image_url: "https://cdn.example.test/south.png" }],
  } });
  test.dependencies.validateAndPersist = async () => { throw new PixelLabCharacterError("pixellab_upstream"); };

  await assertRejects(() => runCharacterLifecycle({ operation: "validate" }, test.state, test.dependencies), PixelLabCharacterError);
  assertEquals(test.transitions, []);
});

Deno.test("allows validation recovery for a failed attempt with a provider job", async () => {
  const test = fixture({
    status: "failed", lastErrorCode: "validation_failed", providerJobId: "provider-character",
    metadata: { providerCharacterId: "provider-character" },
  });
  test.dependencies.poll = async () => ({ structuredContent: {
    status: "completed", character_id: "provider-character",
    rotations: [{ direction: "south", image_url: "https://cdn.example.test/south.png" }],
  } });

  assertEquals(await runCharacterLifecycle({ operation: "validate" }, test.state, test.dependencies), { status: "ready" });
});

Deno.test("persists safe diagnostics when animation output validation fails", async () => {
  const test = fixture({ status: "generating", providerJobId: "provider-character", sourceProviderCharacterId: "provider-character", sourceFacing: "front", plan: { schemaVersion: 1, kind: "animation", name: "walk", sourceCharacterAssetId: IDS.assetId, sourceCharacterSha256: "d".repeat(64), motionDescription: "Walk steadily", frameWidth: 96, frameHeight: 96, frameCount: 6, fps: 10, loop: true } });
  test.dependencies.discover = async () => ({ ...capability, semantic: "animation", operation: "animate_character", pollOperation: "get_character" });
  const provider = { structuredContent: { status: "completed", character_id: "provider-character", animations: [{ display_name: "walk", directions: [{ direction: "south", status: "completed" }] }] } };
  test.dependencies.poll = async () => provider;
  test.dependencies.validateAndPersist = async () => { throw new PixelLabCharacterError("pixellab_invalid_response"); };
  await assertRejects(() => runCharacterLifecycle({ operation: "validate" }, test.state, test.dependencies), PixelLabCharacterError);
  assertEquals((test.transitions.at(-1)?.details.metadata as Record<string, unknown>).providerDiagnostics, {
    keyPaths: ["structuredContent", "structuredContent.animations", "structuredContent.animations[].directions", "structuredContent.animations[].directions[].direction", "structuredContent.animations[].directions[].status", "structuredContent.animations[].display_name", "structuredContent.character_id", "structuredContent.status"],
    textLabels: [], textShapes: [], statusTokens: ["completed"], urlCount: 0,
  });
});

Deno.test("persists diagnostics when retrying validation from a failed attempt", async () => {
  const test = fixture({ status: "failed", lastErrorCode: "validation_failed", providerJobId: "provider-character", sourceProviderCharacterId: "provider-character", sourceFacing: "front", plan: { schemaVersion: 1, kind: "animation", name: "walk", sourceCharacterAssetId: IDS.assetId, sourceCharacterSha256: "d".repeat(64), motionDescription: "Walk steadily", frameWidth: 96, frameHeight: 96, frameCount: 6, fps: 10, loop: true } });
  test.dependencies.discover = async () => ({ ...capability, semantic: "animation", operation: "animate_character", pollOperation: "get_character" });
  test.dependencies.poll = async () => ({ structuredContent: { status: "completed", character_id: "provider-character", animations: [{ display_name: "walk", directions: [{ direction: "south", status: "completed" }] }] } });
  test.dependencies.validateAndPersist = async () => { throw new PixelLabCharacterError("pixellab_invalid_response"); };
  await assertRejects(() => runCharacterLifecycle({ operation: "validate" }, test.state, test.dependencies), PixelLabCharacterError);
  assertEquals(test.transitions.at(-1)?.from, "failed");
});

Deno.test("animation poll follows the requested direction instead of the completed character status", async () => {
  const test = fixture({
    status: "generating", providerJobId: "provider-character", sourceProviderCharacterId: "provider-character", sourceFacing: "left",
    plan: {
      schemaVersion: 1, kind: "animation", name: "walk_left", sourceCharacterAssetId: IDS.assetId,
      sourceCharacterSha256: "d".repeat(64), motionDescription: "Walk steadily", frameWidth: 96,
      frameHeight: 96, frameCount: 6, fps: 10, loop: true,
    },
  });
  test.dependencies.discover = async () => ({ ...capability, semantic: "animation", operation: "animate_character" });
  test.dependencies.poll = async () => ({ structuredContent: {
    status: "completed", character_id: "provider-character",
    animations: [{ display_name: "walk_left", directions: [{ direction: "west", status: "processing" }] }],
  } });
  assertEquals(await runCharacterLifecycle({ operation: "poll" }, test.state, test.dependencies), {
    assetId: IDS.assetId, status: "processing",
    providerDiagnostics: {
      keyPaths: [
        "structuredContent", "structuredContent.animations",
        "structuredContent.animations[].directions",
        "structuredContent.animations[].directions[].direction",
        "structuredContent.animations[].directions[].status",
        "structuredContent.animations[].display_name",
        "structuredContent.character_id", "structuredContent.status",
      ],
      textLabels: [], textShapes: [], statusTokens: ["completed", "processing"], urlCount: 0,
    },
  });
});

Deno.test("animation poll reports a failed PixelLab background job", async () => {
  const test = fixture({
    status: "generating", providerJobId: "animation-job", sourceProviderCharacterId: "provider-character", sourceFacing: "left",
    plan: {
      schemaVersion: 1, kind: "animation", name: "walk_left", sourceCharacterAssetId: IDS.assetId,
      sourceCharacterSha256: "d".repeat(64), motionDescription: "Walk steadily", frameWidth: 96,
      frameHeight: 96, frameCount: 6, fps: 10, loop: true,
    },
  });
  test.dependencies.discover = async () => ({ ...capability, semantic: "animation", operation: "animate_character", pollOperation: "get_background_job" });
  test.dependencies.poll = async () => ({ id: "animation-job", status: "failed", error: "worker unavailable" } as Record<string, unknown>);
  assertEquals(await runCharacterLifecycle({ operation: "poll" }, test.state, test.dependencies), {
    assetId: IDS.assetId, status: "failed",
  });
  assertEquals(test.transitions, [{
    from: "generating", to: "failed", details: {
      expectedAttemptCount: 0, lastErrorCode: "provider_job_failed", metadata: test.state.metadata,
    },
  }]);
});

Deno.test("animation poll fails when the requested direction reports provider failure", async () => {
  const test = fixture({ status: "generating", providerJobId: "provider-character", sourceProviderCharacterId: "provider-character", sourceFacing: "front", plan: { schemaVersion: 1, kind: "animation", name: "walk", sourceCharacterAssetId: IDS.assetId, sourceCharacterSha256: "d".repeat(64), motionDescription: "Walk steadily", frameWidth: 96, frameHeight: 96, frameCount: 6, fps: 10, loop: true } });
  test.dependencies.discover = async () => ({ ...capability, semantic: "animation", operation: "animate_character", pollOperation: "get_character" });
  test.dependencies.poll = async () => ({ structuredContent: { status: "completed", character_id: "provider-character", animations: [{ display_name: "walk", directions: [{ direction: "south", status: "failed", error: "render failed" }] }] } });
  assertEquals(await runCharacterLifecycle({ operation: "poll" }, test.state, test.dependencies), { assetId: IDS.assetId, status: "failed" });
  assertEquals(test.transitions.at(-1), { from: "generating", to: "failed", details: { expectedAttemptCount: 0, lastErrorCode: "provider_job_failed", metadata: test.state.metadata } });
});

Deno.test("resolve_unknown blocks after the safety window without a second paid call", async () => {
  const test = fixture({ status: "queued", updatedAt: "2026-08-27T00:00:00.000Z" });
  const result = await runCharacterLifecycle({ operation: "resolve_unknown", acknowledgeDuplicateBilling: true }, test.state, test.dependencies);
  assertEquals(result, { assetId: IDS.assetId, status: "blocked" });
  assertEquals(test.submissions, []);
  assertEquals(test.transitions, [{
    from: "queued", to: "blocked", details: { lastErrorCode: "pixellab_submit_outcome_unknown" },
  }]);
});
