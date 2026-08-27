import { animationArguments, characterArguments, type PixelLabCharacterClient } from "./pixellab-client.ts";
import { animationResult, characterResult, providerCharacterId, providerStatus } from "./provider-response.ts";
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
  const capability = await dependencies.discover(semantic);
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
      const providerId = semantic === "animation" ? state.sourceProviderCharacterId : providerCharacterId(result);
      if (!providerId) throw new PixelLabCharacterError("pixellab_invalid_response", "Provider character identity is missing");
      await dependencies.transition("queued", "generating", {
        expectedAttemptCount: state.attemptCount + 1,
        providerOperation: capability.operation, providerJobId: providerId,
        schemaFingerprint: capability.schemaFingerprint,
        metadata: { providerCharacterId: providerId, pollOperation: capability.pollOperation, pollSchemaFingerprint: capability.pollSchemaFingerprint },
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
    const status = state.plan.kind === "animation"
      ? animationResult(result, state.plan.name, facing(state) === "front" ? "south" : facing(state) === "back" ? "north" : facing(state) === "left" ? "west" : "east")?.status ?? "processing"
      : providerStatus(result);
    return { assetId: state.assetId, status };
  }
  if (input.operation === "validate") {
    if (state.status !== "generating") throw new PixelLabCharacterError("pixellab_invalid_response", "Character generation is not ready for validation", 409);
    if (!state.providerJobId) throw new PixelLabCharacterError("pixellab_invalid_response", "Provider job is missing", 409);
    const result = await dependencies.poll(capability, state.providerJobId);
    if (providerStatus(result) !== "completed") throw new PixelLabCharacterError("validation_failed", "Provider result is not complete", 409);
    try { return await dependencies.validateAndPersist(state, result); }
    catch (error) {
      await dependencies.transition("generating", "failed", { expectedAttemptCount: state.attemptCount, lastErrorCode: "validation_failed" });
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
    poll: (capability, providerJobId) => client.callTool(capability.pollOperation, { character_id: providerJobId }),
  };
}
