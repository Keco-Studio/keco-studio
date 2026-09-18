import type { SupabaseClient } from "@supabase/supabase-js";
import { validatePng, type ValidatedPng, MAX_PNG_BYTES } from "./png.ts";
import { PixelLabCharacterError, type AuthorizedCharacterAttempt } from "./types.ts";
import {
  finalizeServiceStorage,
  releaseServiceStorage,
  reserveServiceStorage,
} from "../_shared/storage-quota.ts";

export type PersistedCharacterAsset = ValidatedPng & { reservationId: string };

function equal(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((value, index) => value === right[index]);
}

export async function persistValidatedCharacterAsset(
  client: SupabaseClient,
  state: AuthorizedCharacterAttempt,
  bytes: Uint8Array,
  expectation: Parameters<typeof validatePng>[1],
): Promise<PersistedCharacterAsset> {
  const png = await validatePng(bytes, expectation);
  const path = `${state.projectId}/${state.assetId}/${state.generationId}/${png.sha256}.png`;
  const reservation = await reserveServiceStorage(client, {
    actorUserId: state.actorUserId,
    projectId: state.projectId,
    bucketId: "character-assets",
    objectPath: path,
    expectedBytes: MAX_PNG_BYTES,
    displayName: `${state.assetId}.png`,
    mimeType: "image/png",
    sourceKind: "character_asset",
    sourceEntityId: state.assetId,
  });
  const bucket = client.storage.from("character-assets");
  try {
    const upload = await bucket.upload(path, png.bytes, {
      contentType: "image/png", cacheControl: "31536000", upsert: false,
    });
    if (upload.error) {
      const existing = await bucket.download(path);
      if (existing.error || !existing.data || !equal(new Uint8Array(await existing.data.arrayBuffer()), png.bytes)) {
        throw new PixelLabCharacterError("pixellab_upstream", "Storage upload failed");
      }
    }
    const readBack = await bucket.download(path);
    if (readBack.error || !readBack.data || !equal(new Uint8Array(await readBack.data.arrayBuffer()), png.bytes)) {
      throw new PixelLabCharacterError("pixellab_upstream", "Storage read-back failed");
    }
    return { ...png, reservationId: reservation.reservationId };
  } catch (error) {
    await releaseServiceStorage(client, {
      actorUserId: state.actorUserId,
      reservationId: reservation.reservationId,
    }).catch(() => undefined);
    throw error;
  }
}

export async function finalizePersistedCharacterAsset(
  client: SupabaseClient,
  state: AuthorizedCharacterAttempt,
  persisted: PersistedCharacterAsset,
): Promise<void> {
  try {
    await finalizeServiceStorage(client, {
      actorUserId: state.actorUserId,
      reservationId: persisted.reservationId,
      actualBytes: persisted.bytes.byteLength,
      sourceEntityId: state.assetId,
    });
  } catch (error) {
    const storagePath = `${state.projectId}/${state.assetId}/${state.generationId}/${persisted.sha256}.png`;
    // Finalize is the accounting boundary. If it fails, the object has no
    // registry row and must not remain as unaccounted Storage bytes.
    await client.storage.from("character-assets").remove([storagePath]).catch(() => undefined);
    await releaseServiceStorage(client, {
      actorUserId: state.actorUserId,
      reservationId: persisted.reservationId,
    }).catch(() => undefined);
    throw error;
  }
}

export async function releasePersistedCharacterAsset(
  client: SupabaseClient,
  state: AuthorizedCharacterAttempt,
  persisted: PersistedCharacterAsset,
): Promise<void> {
  await releaseServiceStorage(client, {
    actorUserId: state.actorUserId,
    reservationId: persisted.reservationId,
  }).catch(() => undefined);
}
