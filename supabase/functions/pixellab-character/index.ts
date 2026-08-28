import { bearerToken, jsonResponse, readJsonBody } from "./http.ts";
import { authorizeProject, authorizeServiceRequest } from "./auth.ts";
import { PixelLabCharacterClient } from "./pixellab-client.ts";
import { createLifecycleDependencies, runCharacterLifecycle } from "./lifecycle.ts";
import { persistValidatedCharacterAsset } from "./storage.ts";
import { animationResult, characterResult } from "./provider-response.ts";
import { downloadProviderOutput } from "./provider-output.ts";
import { PixelLabCharacterError, type CharacterAssetPlan } from "./types.ts";

async function handle(request: Request): Promise<Response> {
  const body = await readJsonBody(request);
  const operation = String(body.operation ?? "");
  if (operation === "capabilities") {
    await authorizeProject(bearerToken(request), String(body.projectId ?? ""), String(body.actorUserId ?? ""));
    const token = Deno.env.get("PIXELLAB_API_TOKEN") ?? "";
    const client = new PixelLabCharacterClient(token);
    const semantic = body.kind === "animation" ? "animation" : "character";
    return jsonResponse(await client.discover(semantic));
  }
  const authorized = await authorizeServiceRequest(request, body);
  const token = Deno.env.get("PIXELLAB_API_TOKEN") ?? "";
  const client = new PixelLabCharacterClient(token);
  const state = authorized.state as unknown as import("./types.ts").AuthorizedCharacterAttempt;
  const deps = createLifecycleDependencies(client, {
    transition: async (from, to, details = {}) => {
      const { error } = await authorized.serviceClient.rpc("transition_character_generation", {
        p_attempt_id: body.attemptId, p_expected_status: from, p_next_status: to,
        p_expected_attempt_count: Number(details.expectedAttemptCount ?? body.expectedAttemptCount ?? state.attemptCount),
        p_provider_operation: details.providerOperation ?? null, p_provider_transport: "mcp", p_provider_job_id: details.providerJobId ?? null,
        p_provider_schema_fingerprint: details.schemaFingerprint ?? null, p_last_error_code: details.lastErrorCode ?? null,
        p_storage_path: null, p_sha256: null, p_width: null, p_height: null, p_has_transparency: null,
        p_metadata: details.metadata ?? {},
      });
      if (error) throw new PixelLabCharacterError("pixellab_upstream", "Could not persist provider state");
    },
    validateAndPersist: async (current, provider) => {
      const plan = current.plan as CharacterAssetPlan;
      let output: { imageUrl: string | null; frameUrls: string[]; frameData: string[] } = { imageUrl: null, frameUrls: [], frameData: [] };
      let frameCount: number | undefined;
      if (plan.kind === "character") output.imageUrl = characterResult(provider, plan.facing === "front" ? "south" : plan.facing === "back" ? "north" : plan.facing === "left" ? "west" : "east")?.imageUrl ?? null;
      else {
        const direction = current.sourceFacing === "back" ? "north" : current.sourceFacing === "left" ? "west" : current.sourceFacing === "right" ? "east" : "south";
        const result = animationResult(provider, plan.name, direction);
        output = { imageUrl: result?.imageUrl ?? null, frameUrls: result?.frameUrls ?? [], frameData: result?.frameData ?? [] }; frameCount = result?.frameCount;
      }
      const bytes = await downloadProviderOutput(output);
      const validated = await persistValidatedCharacterAsset(authorized.serviceClient, current, bytes, plan.kind === "animation" ? { frameCount: plan.frameCount, frameWidth: plan.frameWidth, frameHeight: plan.frameHeight } : { alphaRequired: true });
      const ready = await authorized.serviceClient.rpc("transition_character_generation", {
        p_attempt_id: current.attemptId, p_expected_status: current.status, p_next_status: "ready", p_expected_attempt_count: current.attemptCount,
        p_provider_operation: null, p_provider_transport: "mcp", p_provider_job_id: null, p_provider_schema_fingerprint: null, p_last_error_code: null,
        p_storage_path: `${current.projectId}/${current.assetId}/${current.generationId}/${validated.sha256}.png`, p_sha256: validated.sha256,
        p_width: validated.width, p_height: validated.height, p_has_transparency: validated.hasTransparency,
        p_metadata: { ...current.metadata, providerCharacterId: current.sourceProviderCharacterId, frameCount },
      });
      const readyRow = Array.isArray(ready.data) ? ready.data[0] : ready.data;
      if (ready.error || !readyRow || readyRow.status !== "ready") throw new PixelLabCharacterError("pixellab_upstream", "Could not persist ready character state");
      return { status: "ready" as const };
    },
  });
  const result = await runCharacterLifecycle({ operation: operation as never, expectedAttemptCount: typeof body.expectedAttemptCount === "number" ? body.expectedAttemptCount : undefined, acknowledgeDuplicateBilling: body.acknowledgeDuplicateBilling === true }, state, deps);
  return jsonResponse(result);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return jsonResponse({}, 204);
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
  try { return await handle(request); } catch (error) {
    if (error instanceof PixelLabCharacterError) {
      // Keep provider diagnostics in function logs without exposing payloads or credentials.
      console.error("[pixellab-character] provider operation failed", { code: error.code, status: error.status });
      return jsonResponse({ error: error.message, code: error.code }, error.status);
    }
    console.error("[pixellab-character] failed", { name: error instanceof Error ? error.name : "UnknownError" });
    return jsonResponse({ error: "PixelLab character operation failed", code: "pixellab_upstream" }, 502);
  }
});
