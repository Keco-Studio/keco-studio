import { assertGenerationIdentity, assertRegionObstacleBackgroundBinding, authorizeAsset, authorizeProject } from "./auth.ts";
import { normalizeTileAtlas } from "./atlas.ts";
import { composeAndPersistBackground } from "./background-storage.ts";
import { bearerToken, jsonResponse, readJsonBody } from "./http.ts";
import { PixelLabClient, providerArgumentsFor } from "./pixellab-client.ts";
import { pngExpectationForAsset, validatePng } from "./png.ts";
import { providerJobId, providerStatus } from "./provider-response.ts";
import { persistValidatedAsset } from "./storage.ts";
import { PixelLabMapError, type SemanticCapability } from "./types.ts";

type EdgeAssetKind = Parameters<typeof pngExpectationForAsset>[0];

function edgeAssetKind(value: unknown): EdgeAssetKind {
  if (["terrain", "road", "object", "inpaint", "path", "obstacle", "background"].includes(String(value))) {
    return value as EdgeAssetKind;
  }
  throw new PixelLabMapError("pixellab_capability_missing", "Unsupported map asset kind", 409);
}

function capabilityFor(kind: EdgeAssetKind): SemanticCapability {
  if (kind === "terrain") return "topdown_tileset";
  if (kind === "road" || kind === "path") return "path_tiles";
  if (kind === "object" || kind === "obstacle") return "map_object";
  if (kind === "inpaint") return "inpaint";
  throw new PixelLabMapError("pixellab_capability_missing", "Unsupported map asset kind", 409);
}

async function transition(serviceClient: ReturnType<typeof authorizeAsset> extends Promise<infer T> ? T extends { serviceClient: infer C } ? C : never : never, assetId: string, from: string, to: string, details: Record<string, unknown> = {}) {
  const { error } = await serviceClient.rpc("transition_map_asset", {
    p_asset_id: assetId, p_expected_status: from, p_next_status: to,
    p_provider_operation: details.operation ?? null, p_provider_transport: details.transport ?? null,
    p_provider_job_id: details.jobId ?? null, p_last_error_code: details.errorCode ?? null,
    p_storage_path: null, p_sha256: null, p_width: null, p_height: null,
    p_has_transparency: null, p_metadata: details.metadata ?? {},
  });
  if (error) throw new PixelLabMapError("pixellab_upstream", "Could not persist provider state");
}

async function handle(request: Request): Promise<Response> {
  const token = bearerToken(request);
  const body = await readJsonBody(request);
  const projectId = typeof body.projectId === "string" ? body.projectId : null;
  const operation = body.operation;
  if (!projectId || typeof operation !== "string") throw new PixelLabMapError("pixellab_invalid_response", "Invalid operation", 400);
  if (operation === "capabilities") {
    await authorizeProject(token, projectId);
    const client = new PixelLabClient(Deno.env.get("PIXELLAB_API_TOKEN") ?? "");
    const capabilities = await Promise.all(([
      "topdown_tileset", "path_tiles", "map_object", "inpaint",
    ] as SemanticCapability[]).map(async (semantic) => {
      try { return await client.discover(semantic); } catch (error) {
        if (error instanceof PixelLabMapError && error.code === "pixellab_capability_missing") return null;
        throw error;
      }
    }));
    return jsonResponse({
      capabilities: capabilities.flatMap((capability) => capability ? [capability.semantic] : []),
    });
  }
  const assetId = typeof body.assetId === "string" ? body.assetId : null;
  if (!assetId) throw new PixelLabMapError("pixellab_invalid_response", "Asset is required", 400);
  const authorized = await authorizeAsset(token, assetId, projectId);
  assertGenerationIdentity(authorized, body);
  const regionMetadata = authorized.asset.metadata && typeof authorized.asset.metadata === "object"
    ? authorized.asset.metadata as Record<string, unknown>
    : {};
  const isRegionObstacle = authorized.asset.kind === "obstacle" && regionMetadata.source === "region-generation";
  if (isRegionObstacle) {
    const referenceIds = Array.isArray(authorized.asset.reference_asset_ids)
      ? authorized.asset.reference_asset_ids.filter((value): value is string => typeof value === "string")
      : [];
    const { data: background } = referenceIds.length === 1
      ? await authorized.userClient.from("map_assets")
        .select("id, map_revision_id, generation_id, kind, status, sha256, plan_fingerprint")
        .eq("id", referenceIds[0]).maybeSingle()
      : { data: null };
    assertRegionObstacleBackgroundBinding(authorized, background as Parameters<typeof assertRegionObstacleBackgroundBinding>[1] | null);
  }
  if (operation === "compose_background") {
    return jsonResponse(await composeAndPersistBackground(authorized));
  }
  if (operation === "submit" || operation === "inpaint") {
    if (body.mapId !== authorized.mapId || body.revisionId !== authorized.revisionId) {
      throw new PixelLabMapError("pixellab_invalid_response", "Map asset identity mismatch", 403);
    }
  }
  if (operation === "inpaint") {
    if (typeof body.sourceAssetId !== "string" || typeof body.maskPath !== "string") {
      throw new PixelLabMapError("pixellab_invalid_response", "Inpaint source and mask are required", 400);
    }
    const source = await authorizeAsset(token, body.sourceAssetId, projectId);
    if (source.mapId !== authorized.mapId || source.revisionId !== authorized.revisionId) {
      throw new PixelLabMapError("pixellab_invalid_response", "Inpaint source mismatch", 403);
    }
  }
  const client = new PixelLabClient(Deno.env.get("PIXELLAB_API_TOKEN") ?? "");
  const kind = edgeAssetKind(authorized.asset.kind);
  const semantic = capabilityFor(kind);
  const capability = await client.discover(semantic);
  if (operation === "submit" || operation === "retry" || operation === "inpaint") {
    const from = operation === "retry"
      ? authorized.asset.status === "blocked" ? "blocked" : "failed"
      : "planned";
    await transition(authorized.serviceClient, assetId, from, "queued");
    const generationParams = authorized.asset.generation_params && typeof authorized.asset.generation_params === "object"
      ? authorized.asset.generation_params as Record<string, unknown> : {};
    let result: Record<string, unknown>;
    try {
      const providerArguments = providerArgumentsFor(
        capability,
        String(authorized.asset.prompt),
        generationParams,
      );
      result = await client.submitAsset(capability, providerArguments);
    } catch (error) {
      const code = error instanceof PixelLabMapError ? error.code : "pixellab_upstream";
      await transition(authorized.serviceClient, assetId, "queued", "failed", { errorCode: code });
      throw error;
    }
    const jobId = providerJobId(result);
    if (!jobId) {
      await transition(authorized.serviceClient, assetId, "queued", "failed", { errorCode: "missing_provider_job" });
      throw new PixelLabMapError("pixellab_invalid_response", "Provider did not return a job id");
    }
    await transition(authorized.serviceClient, assetId, "queued", "generating", {
      operation: capability.operation, transport: capability.transport, jobId,
      metadata: { schemaFingerprint: capability.schemaFingerprint },
    });
    return jsonResponse({ assetId, status: "generating" });
  }
  if (operation === "poll") {
    const jobId = typeof authorized.asset.provider_job_id === "string" ? authorized.asset.provider_job_id : null;
    if (!jobId) throw new PixelLabMapError("pixellab_invalid_response", "Provider job is missing", 409);
    const result = await client.pollJob(capability, jobId);
    const status = providerStatus(result);
    if (status === "failed") {
      await transition(authorized.serviceClient, assetId, "generating", "failed", { errorCode: "pixellab_failed" });
      return jsonResponse({ assetId, status });
    }
    if (status !== "completed") return jsonResponse({ assetId, status });
    const params = authorized.asset.generation_params && typeof authorized.asset.generation_params === "object"
      ? authorized.asset.generation_params as Record<string, unknown> : {};
    let png;
    let normalizedAtlas;
    try {
      const requiredMasks = Array.isArray(params.requiredConnectivityMasks)
        ? params.requiredConnectivityMasks.filter((mask): mask is number => typeof mask === "number")
        : [];
      if (semantic === "topdown_tileset" || semantic === "path_tiles") {
        normalizedAtlas = await normalizeTileAtlas(result, capability, fetch, requiredMasks);
      }
      png = await validatePng(
        normalizedAtlas ? normalizedAtlas.bytes : await client.downloadResult(result),
        pngExpectationForAsset(kind, params),
      );
    } catch (error) {
      const blocked = error instanceof PixelLabMapError && error.code === "atlas_manifest_incomplete";
      await transition(authorized.serviceClient, assetId, "generating", blocked ? "blocked" : "failed", {
        errorCode: blocked ? "atlas_manifest_incomplete" : "validation_failed",
      });
      throw error;
    }
    const ready = await persistValidatedAsset(
      { serviceClient: authorized.serviceClient, projectId: authorized.projectId, mapId: authorized.mapId, revisionId: authorized.revisionId },
      {
        id: assetId,
        assetKey: String(authorized.asset.asset_key),
        expectedStatus: "generating",
        metadata: normalizedAtlas ? { normalizedTileAtlas: normalizedAtlas.manifest } : undefined,
      },
      png,
    );
    return jsonResponse({ assetId, status: "ready", ready });
  }
  throw new PixelLabMapError("pixellab_invalid_response", "Unsupported operation", 400);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return jsonResponse({}, 204);
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
  try { return await handle(request); } catch (error) {
    if (error instanceof PixelLabMapError) return jsonResponse({ error: error.message, code: error.code }, error.status);
    console.error("[pixellab-map] failed", { name: error instanceof Error ? error.name : "UnknownError" });
    return jsonResponse({ error: "PixelLab map operation failed", code: "pixellab_upstream" }, 502);
  }
});
