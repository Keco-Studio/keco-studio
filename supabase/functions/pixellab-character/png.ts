import { decode, encode } from "fast-png";
import { PixelLabCharacterError } from "./types.ts";

export const MAX_PNG_BYTES = 20 * 1024 * 1024;
export type ValidatedPng = { bytes: Uint8Array; width: number; height: number; hasTransparency: boolean; sha256: string };

export async function validatePng(bytes: Uint8Array, expected: { width?: number; height?: number; frameCount?: number; frameWidth?: number; frameHeight?: number; alphaRequired?: boolean }): Promise<ValidatedPng> {
  if (!bytes.byteLength || bytes.byteLength > MAX_PNG_BYTES) throw new PixelLabCharacterError("pixellab_invalid_response", "PNG size is invalid", 422);
  let image: ReturnType<typeof decode>;
  try { image = decode(bytes); } catch { throw new PixelLabCharacterError("pixellab_invalid_response", "PNG is corrupt", 422); }
  if (expected.width != null && image.width !== expected.width) throw new PixelLabCharacterError("validation_failed", "PNG width does not match plan", 422);
  if (expected.height != null && image.height !== expected.height) throw new PixelLabCharacterError("validation_failed", "PNG height does not match plan", 422);
  if (expected.frameCount && expected.frameWidth && expected.frameHeight && (image.width !== expected.frameCount * expected.frameWidth || image.height !== expected.frameHeight)) throw new PixelLabCharacterError("validation_failed", "Animation PNG is not a horizontal spritesheet", 422);
  const channels = image.channels;
  const alphaIndex = channels === 2 ? 1 : channels === 4 ? 3 : -1;
  let visible = 0; let transparent = false; const colors = new Set<string>();
  for (let i = 0; i < image.data.length; i += channels) {
    const alpha = alphaIndex >= 0 ? Number(image.data[i + alphaIndex]) : 255;
    transparent ||= alpha < 255;
    if (alpha > 16) { visible += 1; colors.add(Array.from(image.data.slice(i, i + channels)).join(",")); }
  }
  if (!visible || colors.size < 2 || (expected.alphaRequired && !transparent)) throw new PixelLabCharacterError("validation_failed", "PNG is blank or lacks transparency", 422);
  const digestBytes = new Uint8Array(bytes.byteLength); digestBytes.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", digestBytes);
  return { bytes, width: image.width, height: image.height, hasTransparency: transparent, sha256: Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("") };
}

export function packHorizontal(frames: Uint8Array[]): Uint8Array {
  if (!frames.length) throw new PixelLabCharacterError("validation_failed", "Animation frames are missing", 422);
  const images = frames.map((frame) => decode(frame));
  const width = images[0].width; const height = images[0].height;
  if (images.some((image) => image.width !== width || image.height !== height)) throw new PixelLabCharacterError("validation_failed", "Animation frame sizes differ", 422);
  const channels = images[0].channels; const data = new Uint8Array(width * images.length * height * channels);
  images.forEach((image, index) => { for (let y = 0; y < height; y += 1) data.set(image.data.slice(y * width * channels, (y + 1) * width * channels), (y * width * images.length + index * width) * channels); });
  return encode({ width: width * images.length, height, channels, depth: images[0].depth, data });
}
