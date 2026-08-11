import type { SupabaseClient } from "@supabase/supabase-js";
import type { ValidatedPng } from "./png.ts";
import { MAX_PNG_BYTES } from "./png.ts";
import { PixelLabMapError } from "./types.ts";

export type AssetStorageContext = {
  serviceClient: SupabaseClient;
  projectId: string;
  mapId: string;
  revisionId: string;
};

export type PersistableAsset = {
  id: string;
  assetKey: string;
  expectedStatus?: string;
  metadata?: Record<string, unknown>;
};
export type ReadyAssetBinding = {
  assetId: string;
  storagePath: string;
  sha256: string;
  width: number;
  height: number;
  hasTransparency: boolean;
};

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  return left.every((byte, index) => byte === right[index]);
}

export function mapAssetTransitionStatus(data: unknown): string | null {
  const value = Array.isArray(data) ? data[0] : data;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return typeof (value as Record<string, unknown>).status === "string"
    ? String((value as Record<string, unknown>).status)
    : null;
}

export async function downloadPrivateAsset(serviceClient: SupabaseClient, storagePath: string): Promise<Uint8Array> {
  const download = await serviceClient.storage.from("map-assets").download(storagePath);
  if (download.error || !download.data || download.data.size === 0 || download.data.size > MAX_PNG_BYTES) {
    throw new PixelLabMapError("background_source_mismatch", "Background source download failed", 409);
  }
  const bytes = new Uint8Array(await download.data.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_PNG_BYTES) {
    throw new PixelLabMapError("background_source_mismatch", "Background source size is invalid", 409);
  }
  return bytes;
}

async function failAsset(context: AssetStorageContext, asset: PersistableAsset, code: string): Promise<void> {
  await context.serviceClient.rpc("transition_map_asset", {
    p_asset_id: asset.id, p_expected_status: asset.expectedStatus ?? "generating", p_next_status: "failed",
    p_provider_operation: null, p_provider_transport: null, p_provider_job_id: null,
    p_last_error_code: code, p_storage_path: null, p_sha256: null,
    p_width: null, p_height: null, p_has_transparency: null, p_metadata: {},
  });
}

export async function persistValidatedAsset(
  context: AssetStorageContext,
  asset: PersistableAsset,
  png: ValidatedPng,
): Promise<ReadyAssetBinding> {
  const storagePath = `${context.projectId}/${context.mapId}/${context.revisionId}/${asset.assetKey}/${png.sha256}.png`;
  const bucket = context.serviceClient.storage.from("map-assets");
  try {
    const upload = await bucket.upload(storagePath, png.bytes, {
      contentType: "image/png", cacheControl: "31536000", upsert: false,
    });
    if (upload.error) {
      const existing = await bucket.download(storagePath);
      if (existing.error || !existing.data) throw new Error("upload failed");
      const existingBytes = new Uint8Array(await existing.data.arrayBuffer());
      if (!equalBytes(existingBytes, png.bytes)) throw new Error("existing object mismatch");
    }
    const readBack = await bucket.download(storagePath);
    if (readBack.error || !readBack.data) throw new Error("read-back failed");
    const readBackBytes = new Uint8Array(await readBack.data.arrayBuffer());
    if (!equalBytes(readBackBytes, png.bytes)) throw new Error("read-back mismatch");

    const { data, error } = await context.serviceClient.rpc("transition_map_asset", {
      p_asset_id: asset.id, p_expected_status: asset.expectedStatus ?? "generating", p_next_status: "ready",
      p_provider_operation: null, p_provider_transport: null, p_provider_job_id: null,
      p_last_error_code: null, p_storage_path: storagePath, p_sha256: png.sha256,
      p_width: png.width, p_height: png.height, p_has_transparency: png.hasTransparency,
      p_metadata: {
        ...asset.metadata,
        verifiedReadBack: true,
        alphaBounds: png.alphaBounds,
        opaquePixelCount: png.opaquePixelCount,
        visiblePixelCount: png.visiblePixelCount,
        opaqueFillRatio: png.opaqueFillRatio,
      },
    });
    if (error) throw new Error("ready transition failed");
    if (mapAssetTransitionStatus(data) !== "ready") {
      throw new PixelLabMapError("pixellab_invalid_response", "Map asset state changed before storage completed", 409);
    }
    return { assetId: asset.id, storagePath, sha256: png.sha256, width: png.width, height: png.height, hasTransparency: png.hasTransparency };
  } catch (error) {
    await failAsset(context, asset, "storage_failed");
    if (error instanceof PixelLabMapError) throw error;
    throw new PixelLabMapError("pixellab_upstream", "Validated asset storage failed");
  }
}
