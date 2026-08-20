import { assertGenerationIdentity, assertRegionObstacleBackgroundBinding, authorizeAsset, authorizeGddMapAsset, authorizeProject } from "./auth.ts";
import { normalizeTileAtlas } from "./atlas.ts";
import { composeAndPersistBackground } from "./background-storage.ts";
import { runDirectMapLifecycle } from "./direct-map-lifecycle.ts";
import { bearerToken, jsonResponse, readJsonBody } from "./http.ts";
import { PixelLabClient, providerArgumentsFor } from "./pixellab-client.ts";
import { pngExpectationForAsset, validatePng } from "./png.ts";
import { providerContentQualityIssue, providerJobId, providerStatus } from "./provider-response.ts";
import { mapAssetTransitionStatus, persistValidatedAsset } from "./storage.ts";
import { PixelLabMapError, type SemanticCapability } from "./types.ts";

type EdgeAssetKind = Parameters<typeof pngExpectationForAsset>[0];

function edgeAssetKind(value: unknown): EdgeAssetKind {
  if (["terrain", "road", "object", "inpaint", "path", "obstacle", "background", "map_image"].includes(String(value))) {
    return value as EdgeAssetKind;
  }
  throw new PixelLabMapError("pixellab_capability_missing", "Unsupported map asset kind", 409);
}

function capabilityFor(kind: EdgeAssetKind): SemanticCapability {
  if (kind === "terrain") return "topdown_tileset";
  if (kind === "road" || kind === "path") return "path_tiles";
  if (kind === "object" || kind === "obstacle") return "map_object";
  if (kind === "inpaint") return "inpaint";
  if (kind === "map_image") return "direct_map_image";
  throw new PixelLabMapError("pixellab_capability_missing", "Unsupported map asset kind", 409);
}

async function transition(serviceClient: ReturnType<typeof authorizeAsset> extends Promise<infer T> ? T extends { serviceClient: infer C } ? C : never : never, assetId: string, from: string, to: string, details: Record<string, unknown> = {}) {
  const { data, error } = await serviceClient.rpc("transition_map_asset", {
    p_asset_id: assetId, p_expected_status: from, p_next_status: to,
    p_provider_operation: details.operation ?? null, p_provider_transport: details.transport ?? null,
    p_provider_job_id: details.jobId ?? null, p_last_error_code: details.errorCode ?? null,
    p_storage_path: null, p_sha256: null, p_width: null, p_height: null,
    p_has_transparency: null, p_metadata: details.metadata ?? {},
  });
  if (error) throw new PixelLabMapError("pixellab_upstream", "Could not persist provider state");
  if (mapAssetTransitionStatus(data) !== to) {
    throw new PixelLabMapError("pixellab_invalid_response", "Map asset state changed", 409);
  }
}

async function styleReferenceUrl(
  authorized: Awaited<ReturnType<typeof authorizeAsset>>,
  capability: Awaited<ReturnType<PixelLabClient["discover"]>>,
): Promise<string | null> {
  if (capability.semantic !== "map_object") return null;
  const references = Array.isArray(authorized.asset.reference_asset_ids)
    ? authorized.asset.reference_asset_ids.filter((value): value is string => typeof value === "string")
    : [];
  const hashes = Array.isArray(authorized.asset.reference_hashes)
    ? authorized.asset.reference_hashes.filter((value): value is string => typeof value === "string")
    : [];
  if (references.length !== 1 || hashes.length !== 1) return null;
  const { data: background } = await authorized.serviceClient.from("map_assets")
    .select("id, map_revision_id, generation_id, kind, status, storage_path, sha256, plan_fingerprint")
    .eq("id", references[0]).maybeSingle();
  if (!background || background.kind !== "background" || background.status !== "ready"
    || background.map_revision_id !== authorized.revisionId || background.generation_id !== authorized.generationId
    || background.sha256 !== hashes[0] || typeof background.storage_path !== "string") {
    throw new PixelLabMapError("pixellab_invalid_response", "Obstacle style background binding is invalid", 403);
  }
  const schema = capability.inputSchema.properties;
  const supportsStyle = !schema || typeof schema !== "object" || Object.keys(schema as object).length === 0
    || Object.prototype.hasOwnProperty.call(schema, "style_image_url");
  if (!supportsStyle) return null;
  const signed = await authorized.serviceClient.storage.from("map-assets").createSignedUrl(background.storage_path, 300);
  if (signed.error || !signed.data?.signedUrl) {
    throw new PixelLabMapError("pixellab_upstream", "Could not prepare the obstacle style reference", 502);
  }
  return signed.data.signedUrl;
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
      "topdown_tileset", "path_tiles", "map_object", "inpaint", "direct_map_image",
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
  const serviceRoleRequest = Boolean(token && token === (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""));
  let authorized;
  if (serviceRoleRequest) {
    if (typeof body.gddMapArtifactId !== "string" || typeof body.actorUserId !== "string") {
      throw new PixelLabMapError("pixellab_invalid_response", "GDD map worker identity is required", 403);
    }
    authorized = await authorizeGddMapAsset(token, assetId, projectId, body.gddMapArtifactId, body.actorUserId);
  } else {
    authorized = await authorizeAsset(token, assetId, projectId);
  }
  assertGenerationIdentity(authorized, body);
  const kind = edgeAssetKind(authorized.asset.kind);
  if (kind === "map_image") {
    if (!["submit", "retry", "poll", "validate", "resolve_unknown"].includes(operation)) {
      throw new PixelLabMapError("pixellab_invalid_response", "Unsupported direct map operation", 400);
    }
    const client = new PixelLabClient(Deno.env.get("PIXELLAB_API_TOKEN") ?? "");
    return jsonResponse(await runDirectMapLifecycle({
      operation: operation as "submit" | "retry" | "poll" | "validate" | "resolve_unknown",
      authorized,
      client,
      transitionAsset: transition,
      acknowledgeDuplicateBilling: body.acknowledgeDuplicateBilling === true,
    }));
  }
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
      const styleImageUrl = await styleReferenceUrl(authorized, capability);
      const providerParams = styleImageUrl ? { ...generationParams, styleImageUrl } : generationParams;
      const providerArguments = providerArgumentsFor(
        capability,
        String(authorized.asset.prompt),
        providerParams,
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
      const styleImageUrl = await styleReferenceUrl(authorized, capability);
      const providerParams = styleImageUrl ? { ...params, styleImageUrl } : params;
      const qualityIssue = providerContentQualityIssue(result);
      if (qualityIssue) {
        await transition(authorized.serviceClient, assetId, "generating", "failed", { errorCode: "pixellab_content_quality", metadata: { qualityIssue } });
        throw new PixelLabMapError("pixellab_content_quality", "PixelLab returned character content for a static obstacle", 422);
      }
      const providerParamsForValidation = providerArgumentsFor(
        capability,
        String(authorized.asset.prompt),
        providerParams,
      );
      png = await validatePng(
        normalizedAtlas ? normalizedAtlas.bytes : await client.downloadResult(result),
        pngExpectationForAsset(kind, providerParamsForValidation),
      );
    } catch (error) {
      const blocked = error instanceof PixelLabMapError && error.code === "atlas_manifest_incomplete";
      const alreadyFailed = error instanceof PixelLabMapError && error.code === "pixellab_content_quality";
      if (!alreadyFailed) {
        await transition(authorized.serviceClient, assetId, "generating", blocked ? "blocked" : "failed", {
          errorCode: blocked ? "atlas_manifest_incomplete" : "validation_failed",
        });
      }
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
