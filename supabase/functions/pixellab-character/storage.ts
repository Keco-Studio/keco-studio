import type { SupabaseClient } from "@supabase/supabase-js";
import { validatePng, type ValidatedPng } from "./png.ts";
import { PixelLabCharacterError, type AuthorizedCharacterAttempt } from "./types.ts";

function equal(left: Uint8Array, right: Uint8Array): boolean { return left.byteLength === right.byteLength && left.every((value, index) => value === right[index]); }
export async function persistValidatedCharacterAsset(client: SupabaseClient, state: AuthorizedCharacterAttempt, bytes: Uint8Array, expectation: Parameters<typeof validatePng>[1]): Promise<ValidatedPng> {
  const png = await validatePng(bytes, expectation);
  const path = `${state.projectId}/${state.assetId}/${state.generationId}/${png.sha256}.png`;
  const bucket = client.storage.from("character-assets");
  const upload = await bucket.upload(path, png.bytes, { contentType: "image/png", cacheControl: "31536000", upsert: false });
  if (upload.error) {
    const existing = await bucket.download(path);
    if (existing.error || !existing.data || !equal(new Uint8Array(await existing.data.arrayBuffer()), png.bytes)) throw new PixelLabCharacterError("pixellab_upstream", "Storage upload failed");
  }
  const readBack = await bucket.download(path);
  if (readBack.error || !readBack.data || !equal(new Uint8Array(await readBack.data.arrayBuffer()), png.bytes)) throw new PixelLabCharacterError("pixellab_upstream", "Storage read-back failed");
  return png;
}
