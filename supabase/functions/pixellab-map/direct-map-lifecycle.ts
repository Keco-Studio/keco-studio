import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthorizedAsset } from "./auth.ts";
import {
  assertStoredDirectMapCapability,
  directMapProviderArguments,
  resolveDirectMapReferences,
  type ResolvedDirectMapReferences,
} from "./direct-map.ts";
import type { PixelLabClient } from "./pixellab-client.ts";
import { pngExpectationForAsset, validatePng } from "./png.ts";
import { providerJobId, providerStatus } from "./provider-response.ts";
import { persistValidatedAsset, type PersistableAsset } from "./storage.ts";
import { PixelLabMapError, type DiscoveredCapability } from "./types.ts";

type DirectMapOperation = "submit" | "retry" | "poll" | "validate" | "resolve_unknown";
type DirectMapClient = Pick<PixelLabClient, "discover" | "submitAsset" | "pollJob" | "downloadResult">;
type TransitionAsset = (
  serviceClient: SupabaseClient,
  assetId: string,
  from: string,
  to: string,
  details?: Record<string, unknown>,
) => Promise<void>;
type PersistAsset = typeof persistValidatedAsset;
const SAFE_SUBMISSION_REJECTION_CODES = new Set([
  "pixellab_rate_limited",
  "pixellab_quota_exceeded",
]);
const UNKNOWN_SUBMISSION_OUTCOME = "pixellab_submit_outcome_unknown";
const UNKNOWN_SUBMISSION_SAFETY_WINDOW_MS = 2 * 60 * 1000;

export type DirectMapLifecycleOptions = {
  operation: DirectMapOperation;
  authorized: AuthorizedAsset;
  client: DirectMapClient;
  transitionAsset: TransitionAsset;
  persistAsset?: PersistAsset;
  resolveReferences?: (authorized: AuthorizedAsset) => Promise<ResolvedDirectMapReferences>;
  acknowledgeDuplicateBilling?: boolean;
  now?: () => number;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function directAsset(authorized: AuthorizedAsset): Record<string, unknown> {
  const asset = authorized.asset;
  if (
    authorized.schemaVersion !== 3
    || asset.kind !== "map_image"
    || asset.asset_key !== "map-image"
    || asset.requested_capability !== "direct_map_image"
  ) {
    throw new PixelLabMapError("pixellab_capability_missing", "Unsupported direct map asset", 409);
  }
  return asset;
}

function errorCode(error: unknown): string {
  return error instanceof PixelLabMapError ? error.code : "pixellab_upstream";
}

async function blockCapabilityDrift(
  options: DirectMapLifecycleOptions,
  assetId: string,
  status: string,
  error: unknown,
): Promise<void> {
  if (!(error instanceof PixelLabMapError) || error.code !== "pixellab_capability_missing") return;
  if (status === "planned" || status === "failed" || status === "generating") {
    await options.transitionAsset(options.authorized.serviceClient, assetId, status, "blocked", {
      errorCode: error.code,
    });
  }
}

async function discoverStoredCapability(
  options: DirectMapLifecycleOptions,
  asset: Record<string, unknown>,
  assetId: string,
): Promise<DiscoveredCapability> {
  try {
    const capability = await options.client.discover("direct_map_image");
    assertStoredDirectMapCapability(asset, capability);
    return capability;
  } catch (error) {
    await blockCapabilityDrift(options, assetId, String(asset.status), error);
    throw error;
  }
}

async function submitDirectMap(
  options: DirectMapLifecycleOptions,
  asset: Record<string, unknown>,
  assetId: string,
): Promise<Record<string, unknown>> {
  const status = String(asset.status);
  if (
    options.operation === "retry"
    && (
      (status === "blocked" && !SAFE_SUBMISSION_REJECTION_CODES.has(String(asset.last_error_code)))
      || (status === "failed" && !asset.provider_job_id)
    )
  ) {
    throw new PixelLabMapError(
      "pixellab_invalid_response",
      "Direct map submission outcome is not safe to retry",
      409,
    );
  }
  const expected = options.operation === "retry"
    ? status === "blocked" ? "blocked" : "failed"
    : "planned";
  if (status !== expected) {
    throw new PixelLabMapError("pixellab_invalid_response", "Direct map asset is not submit-ready", 409);
  }

  let capability: DiscoveredCapability;
  let providerArguments: Record<string, unknown>;
  try {
    capability = await options.client.discover("direct_map_image");
    const references = await (options.resolveReferences ?? resolveDirectMapReferences)(options.authorized);
    providerArguments = directMapProviderArguments(capability, {
      prompt: String(asset.prompt),
      generationParams: record(asset.generation_params),
    }, references);
  } catch (error) {
    if (status !== "blocked") {
      await options.transitionAsset(options.authorized.serviceClient, assetId, status, "blocked", {
        errorCode: errorCode(error),
      });
    }
    throw error;
  }

  await options.transitionAsset(options.authorized.serviceClient, assetId, status, "queued");
  let result: Record<string, unknown>;
  try {
    result = await options.client.submitAsset(capability, providerArguments);
  } catch (error) {
    const code = errorCode(error);
    await options.transitionAsset(options.authorized.serviceClient, assetId, "queued", "blocked", {
      errorCode: SAFE_SUBMISSION_REJECTION_CODES.has(code) ? code : UNKNOWN_SUBMISSION_OUTCOME,
    });
    throw error;
  }
  const jobId = providerJobId(result);
  if (!jobId) {
    await options.transitionAsset(options.authorized.serviceClient, assetId, "queued", "blocked", {
      errorCode: UNKNOWN_SUBMISSION_OUTCOME,
    });
    throw new PixelLabMapError("pixellab_invalid_response", "Provider did not return a job id");
  }
  await options.transitionAsset(options.authorized.serviceClient, assetId, "queued", "generating", {
    operation: capability.operation,
    transport: capability.transport,
    jobId,
    metadata: {
      schemaFingerprint: capability.schemaFingerprint,
      pollOperation: capability.pollOperation,
      pollSchemaFingerprint: capability.pollSchemaFingerprint,
    },
  });
  return { assetId, status: "generating" };
}

async function resolveUnknownSubmission(
  options: DirectMapLifecycleOptions,
  asset: Record<string, unknown>,
  assetId: string,
): Promise<Record<string, unknown>> {
  if (options.acknowledgeDuplicateBilling !== true) {
    throw new PixelLabMapError(
      "pixellab_invalid_response",
      "Duplicate billing acknowledgement is required",
      400,
    );
  }
  if (asset.status === "blocked" && asset.last_error_code === UNKNOWN_SUBMISSION_OUTCOME) {
    return { assetId, status: "blocked" };
  }
  if (asset.status !== "queued") {
    throw new PixelLabMapError("pixellab_invalid_response", "Direct map submission is not unresolved", 409);
  }
  const updatedAt = typeof asset.updated_at === "string" ? Date.parse(asset.updated_at) : Number.NaN;
  const now = (options.now ?? Date.now)();
  if (!Number.isFinite(updatedAt) || now - updatedAt < UNKNOWN_SUBMISSION_SAFETY_WINDOW_MS) {
    throw new PixelLabMapError(
      "pixellab_invalid_response",
      "Wait two minutes before resolving an unknown paid submission",
      409,
    );
  }
  await options.transitionAsset(options.authorized.serviceClient, assetId, "queued", "blocked", {
    errorCode: UNKNOWN_SUBMISSION_OUTCOME,
  });
  return { assetId, status: "blocked" };
}

async function pollDirectMap(
  options: DirectMapLifecycleOptions,
  asset: Record<string, unknown>,
  assetId: string,
): Promise<Record<string, unknown>> {
  if (asset.status !== "generating") {
    throw new PixelLabMapError("pixellab_invalid_response", "Direct map asset is not generating", 409);
  }
  const jobId = typeof asset.provider_job_id === "string" ? asset.provider_job_id : null;
  if (!jobId) throw new PixelLabMapError("pixellab_invalid_response", "Provider job is missing", 409);
  const capability = await discoverStoredCapability(options, asset, assetId);
  const result = await options.client.pollJob(capability, jobId);
  const status = providerStatus(result);
  if (status === "failed") {
    await options.transitionAsset(options.authorized.serviceClient, assetId, "generating", "failed", {
      errorCode: "pixellab_failed",
    });
  }
  return { assetId, status };
}

async function validateDirectMap(
  options: DirectMapLifecycleOptions,
  asset: Record<string, unknown>,
  assetId: string,
): Promise<Record<string, unknown>> {
  if (asset.status !== "generating") {
    throw new PixelLabMapError("pixellab_invalid_response", "Direct map asset is not generating", 409);
  }
  const jobId = typeof asset.provider_job_id === "string" ? asset.provider_job_id : null;
  if (!jobId) throw new PixelLabMapError("pixellab_invalid_response", "Provider job is missing", 409);
  const capability = await discoverStoredCapability(options, asset, assetId);
  const result = await options.client.pollJob(capability, jobId);
  if (providerStatus(result) !== "completed") {
    throw new PixelLabMapError("pixellab_invalid_response", "Direct map is not ready for validation", 409);
  }

  let png;
  try {
    png = await validatePng(
      await options.client.downloadResult(result),
      pngExpectationForAsset("map_image", record(asset.generation_params)),
    );
  } catch (error) {
    await options.transitionAsset(options.authorized.serviceClient, assetId, "generating", "failed", {
      errorCode: "validation_failed",
    });
    throw error;
  }
  const persistable: PersistableAsset = {
    id: assetId,
    assetKey: "map-image",
    expectedStatus: "generating",
    metadata: {
      schemaFingerprint: capability.schemaFingerprint,
      pollOperation: capability.pollOperation,
      pollSchemaFingerprint: capability.pollSchemaFingerprint,
      candidateIndex: 0,
    },
  };
  const ready = await (options.persistAsset ?? persistValidatedAsset)(
    {
      serviceClient: options.authorized.serviceClient,
      projectId: options.authorized.projectId,
      mapId: options.authorized.mapId,
      revisionId: options.authorized.revisionId,
    },
    persistable,
    png,
  );
  return { assetId, status: "ready", ready };
}

export async function runDirectMapLifecycle(options: DirectMapLifecycleOptions): Promise<Record<string, unknown>> {
  const asset = directAsset(options.authorized);
  const assetId = String(asset.id);
  if (options.operation === "resolve_unknown") {
    return resolveUnknownSubmission(options, asset, assetId);
  }
  if (options.operation === "submit" || options.operation === "retry") {
    return submitDirectMap(options, asset, assetId);
  }
  if (options.operation === "poll") return pollDirectMap(options, asset, assetId);
  return validateDirectMap(options, asset, assetId);
}
