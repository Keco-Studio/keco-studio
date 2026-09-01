import { animationArguments, characterArguments, type PixelLabCharacterClient } from "./pixellab-client.ts";
import { animationResult, characterResult, providerCharacterId, providerResponseDiagnostics, providerStatus } from "./provider-response.ts";
import { PixelLabCharacterError, type AuthorizedCharacterAttempt, type CharacterCapability, type LifecycleOperation } from "./types.ts";

type Dependencies = {
  discover: (semantic: "character" | "animation") => Promise<CharacterCapability>;
  submit: (capability: CharacterCapability, args: Record<string, unknown>) => Promise<Record<string, unknown>>;
  poll: (capability: CharacterCapability, providerJobId: string) => Promise<Record<string, unknown>>;
  transition: (from: string, to: string, details?: Record<string, unknown>) => Promise<void>;
  validateAndPersist: (state: AuthorizedCharacterAttempt, provider: Record<string, unknown>) => Promise<{ status: "ready" }>;
  now?: () => number;
};

function facing(state: AuthorizedCharacterAttempt): "front" | "back" | "left" | "right" {
  return state.plan.kind === "character" ? state.plan.facing : state.sourceFacing ?? "front";
}

function outputMaterialized(state: AuthorizedCharacterAttempt, provider: Record<string, unknown>): boolean {
  if (state.plan.kind === "character") {
    const direction = facing(state) === "front" ? "south" : facing(state) === "back" ? "north" : facing(state) === "left" ? "west" : "east";
    return Boolean(characterResult(provider, direction)?.imageUrl);
  }
  const direction = facing(state) === "front" ? "south" : facing(state) === "back" ? "north" : facing(state) === "left" ? "west" : "east";
  const result = animationResult(provider, state.plan.name, direction);
  return Boolean(result && (result.imageUrl || result.frameUrls.length || result.frameData.length));
}

export async function runCharacterLifecycle(
  input: { operation: LifecycleOperation; expectedAttemptCount?: number; acknowledgeDuplicateBilling?: boolean },
  state: AuthorizedCharacterAttempt,
  dependencies: Dependencies,
) {
  if (input.operation === "resolve_unknown") {
    if (state.status !== "queued" || !input.acknowledgeDuplicateBilling) throw new PixelLabCharacterError("pixellab_invalid_response", "Unknown submission cannot be resolved safely", 409);
    if (state.updatedAt && (dependencies.now?.() ?? Date.now()) - Date.parse(state.updatedAt) < 120_000) throw new PixelLabCharacterError("pixellab_invalid_response", "Submission safety window has not elapsed", 409);
    await dependencies.transition("queued", "blocked", { lastErrorCode: "pixellab_submit_outcome_unknown" });
    return { assetId: state.assetId, status: "blocked" };
  }

  const semantic = state.plan.kind;
  // Submission needs live capability discovery. Polling and validation should
  // reuse the operation/schema captured when the paid job was submitted so a
  // transient tools/list outage cannot strand an otherwise valid provider job.
  let capability: CharacterCapability;
  const savedPollOperation = state.metadata?.pollOperation;
  const savedPollSchemaFingerprint = state.metadata?.pollSchemaFingerprint;
  const canReusePollCapability = (input.operation === "poll" || input.operation === "validate")
    && (savedPollOperation === "get_character" || savedPollOperation === "get_background_job")
    && typeof savedPollSchemaFingerprint === "string";
  if (canReusePollCapability) {
    capability = {
      semantic,
      operation: semantic === "character" ? "create_character" : "animate_character",
      // Animation V3 is bound to the source character and is retrieved via
      // get_character. Older attempts persisted get_background_job here;
      // recover those checkpoints without creating a new paid submission.
      pollOperation: semantic === "animation" ? "get_character" : savedPollOperation,
      schemaFingerprint: "",
      pollSchemaFingerprint: savedPollSchemaFingerprint,
      inputSchema: {},
      pollInputSchema: {},
    };
  } else {
    capability = await dependencies.discover(semantic);
  }
  if (input.operation === "submit" || input.operation === "retry") {
    if (!Number.isSafeInteger(input.expectedAttemptCount) || input.expectedAttemptCount !== state.attemptCount) throw new PixelLabCharacterError("authorization_failed", "Expected attempt count is required", 403);
    const from = input.operation === "retry" ? state.status : "planned";
    if (input.operation === "retry" && !["failed", "blocked"].includes(state.status)) throw new PixelLabCharacterError("pixellab_invalid_response", "Character generation is not retryable", 409);
    if (state.status === "blocked" && state.lastErrorCode === "pixellab_submit_outcome_unknown" && !input.acknowledgeDuplicateBilling) throw new PixelLabCharacterError("pixellab_invalid_response", "Retry requires duplicate billing acknowledgement", 409);
    await dependencies.transition(from, "queued", { expectedAttemptCount: input.expectedAttemptCount });
    try {
      const args = semantic === "character"
        ? characterArguments(state.plan)
        : animationArguments(state.plan, state.sourceProviderCharacterId ?? "", facing(state));
      const result = await dependencies.submit(capability, args);
      // V3 animation jobs are bound to the ready source character and are
      // polled through get_character. Persist that verified identity rather
      // than interpreting the submission acknowledgement as a separate job.
      const providerId = semantic === "animation" ? state.sourceProviderCharacterId : providerCharacterId(result);
      if (!providerId) {
        throw new PixelLabCharacterError("pixellab_invalid_response", "Provider character identity is missing");
      }
      await dependencies.transition("queued", "generating", {
        expectedAttemptCount: state.attemptCount + 1,
        providerOperation: capability.operation, providerJobId: providerId,
        schemaFingerprint: capability.schemaFingerprint,
        metadata: semantic === "animation"
          ? { providerCharacterId: state.sourceProviderCharacterId, pollOperation: capability.pollOperation, pollSchemaFingerprint: capability.pollSchemaFingerprint }
          : { providerCharacterId: providerId, pollOperation: capability.pollOperation, pollSchemaFingerprint: capability.pollSchemaFingerprint },
      });
      return { assetId: state.assetId, status: "generating" };
    } catch (error) {
      if (error instanceof PixelLabCharacterError && error.code !== "pixellab_upstream") {
        await dependencies.transition("queued", "failed", { expectedAttemptCount: state.attemptCount + 1, lastErrorCode: error.code });
        throw error;
      }
      await dependencies.transition("queued", "blocked", { expectedAttemptCount: state.attemptCount + 1, lastErrorCode: "pixellab_submit_outcome_unknown" });
      throw error instanceof PixelLabCharacterError ? error : new PixelLabCharacterError("pixellab_submit_outcome_unknown");
    }
  }

  if (input.operation === "poll") {
    if (!state.providerJobId) throw new PixelLabCharacterError("pixellab_invalid_response", "Provider job is missing", 409);
    const result = await dependencies.poll(capability, state.providerJobId);
    const status = state.plan.kind === "animation" && capability.pollOperation === "get_character"
      ? animationResult(result, state.plan.name, facing(state) === "front" ? "south" : facing(state) === "back" ? "north" : facing(state) === "left" ? "west" : "east")?.status ?? "processing"
      : providerStatus(result);
    // PixelLab can report a completed job before the directional image/sheet
    // is materialized. Keep polling the same paid job instead of turning this
    // transient window into a terminal validation failure.
    if (status === "completed" && !outputMaterialized(state, result)) {
      return state.plan.kind === "animation"
        ? { assetId: state.assetId, status: "processing", providerDiagnostics: providerResponseDiagnostics(result) }
        : { assetId: state.assetId, status: "processing" };
    }
    if (status === "failed" && state.status === "generating") {
      await dependencies.transition("generating", "failed", {
        expectedAttemptCount: state.attemptCount,
        lastErrorCode: "provider_job_failed",
        metadata: state.metadata,
      });
    }
    return state.plan.kind === "animation" && status === "processing"
      ? { assetId: state.assetId, status, providerDiagnostics: providerResponseDiagnostics(result) }
      : { assetId: state.assetId, status };
  }
  if (input.operation === "validate") {
    const recovery = state.status === "failed" && state.lastErrorCode === "validation_failed" && Boolean(state.providerJobId);
    if (state.status !== "generating" && !recovery) throw new PixelLabCharacterError("pixellab_invalid_response", "Character generation is not ready for validation", 409);
    if (!state.providerJobId) throw new PixelLabCharacterError("pixellab_invalid_response", "Provider job is missing", 409);
    const result = await dependencies.poll(capability, state.providerJobId);
    if (providerStatus(result) !== "completed") throw new PixelLabCharacterError("validation_failed", "Provider result is not complete", 409);
    try { return await dependencies.validateAndPersist(state, result); }
    catch (error) {
      // Provider/storage outages are transient. Keep the paid job generating so
      // the next advance can poll and validate the same provider result again.
      if (!(error instanceof PixelLabCharacterError) || error.code !== "pixellab_upstream") {
        await dependencies.transition("generating", "failed", {
          expectedAttemptCount: state.attemptCount,
          lastErrorCode: "validation_failed",
          metadata: state.plan.kind === "animation"
            ? { ...state.metadata, providerDiagnostics: providerResponseDiagnostics(result) }
            : state.metadata,
        });
      }
      throw error;
    }
  }
  throw new PixelLabCharacterError("pixellab_invalid_response", "Unsupported operation", 400);
}

export function createLifecycleDependencies(client: PixelLabCharacterClient, extras: Omit<Dependencies, "discover" | "submit" | "poll">): Dependencies {
  return {
    ...extras,
    discover: (semantic) => client.discover(semantic),
    submit: (capability, args) => client.callTool(capability.operation, args),
    poll: (capability, providerJobId) => capability.pollOperation === "get_background_job"
      ? client.getBackgroundJob(providerJobId)
      : client.callTool(capability.pollOperation, { character_id: providerJobId }),
  };
}
