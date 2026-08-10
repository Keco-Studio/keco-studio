import { decode } from "fast-png";
import { PixelLabMapError } from "./types.ts";

export const MAX_PNG_BYTES = 10 * 1024 * 1024;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export type PngExpectation = {
  width?: number;
  height?: number;
  tileSize?: number;
  alpha?: "required" | "forbidden" | "optional";
};

export type ValidatedPng = {
  bytes: Uint8Array;
  width: number;
  height: number;
  hasTransparency: boolean;
  sha256: string;
  alphaBounds: { x: number; y: number; width: number; height: number } | null;
  opaquePixelCount: number;
  visiblePixelCount: number;
  opaqueFillRatio: number;
};

export function pngExpectationForAsset(
  kind: "terrain" | "road" | "object" | "inpaint" | "path" | "obstacle" | "background",
  params: Record<string, unknown>,
): PngExpectation {
  const tileSize = typeof params.tile_size === "number"
    ? params.tile_size
    : params.tile_size && typeof params.tile_size === "object" &&
        typeof (params.tile_size as Record<string, unknown>).width === "number"
      ? (params.tile_size as Record<string, number>).width
      : typeof params.tileSize === "number" ? params.tileSize : undefined;
  const expectation: PngExpectation = {
    alpha: kind === "terrain" ? "forbidden"
      : kind === "road" || kind === "path" || kind === "object" || kind === "obstacle" ? "required"
      : "optional",
  };
  if (typeof params.width === "number") expectation.width = params.width;
  if (typeof params.height === "number") expectation.height = params.height;
  if (tileSize != null) expectation.tileSize = tileSize;
  return expectation;
}

function invalid(message: string): never {
  throw new PixelLabMapError("pixellab_invalid_response", message, 422);
}

export async function validatePng(bytes: Uint8Array, expectation: PngExpectation): Promise<ValidatedPng> {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_PNG_BYTES) invalid("PNG size is invalid");
  if (!PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) invalid("Provider result is not PNG");

  let image: ReturnType<typeof decode>;
  try {
    image = decode(bytes);
  } catch {
    invalid("Provider PNG is truncated or corrupt");
  }
  if (expectation.width != null && image.width !== expectation.width) invalid("PNG width does not match the asset plan");
  if (expectation.height != null && image.height !== expectation.height) invalid("PNG height does not match the asset plan");
  if (expectation.tileSize != null && (
    expectation.tileSize <= 0 || image.width % expectation.tileSize !== 0 || image.height % expectation.tileSize !== 0
  )) invalid("PNG dimensions do not align to the tile grid");

  const max = image.depth === 16 ? 65535 : 255;
  const visibleAlphaThreshold = image.depth === 16 ? 16 * 257 : 16;
  const channels = image.channels;
  const alphaIndex = channels === 2 ? 1 : channels === 4 ? 3 : -1;
  let hasTransparentPixel = false;
  let hasVisiblePixel = false;
  let opaquePixelCount = 0;
  let visiblePixelCount = 0;
  let minX = image.width;
  let minY = image.height;
  let maxX = -1;
  let maxY = -1;
  const visibleColors = new Set<string>();
  for (let offset = 0; offset < image.data.length; offset += channels) {
    const alpha = alphaIndex >= 0 ? Number(image.data[offset + alphaIndex]) : max;
    const pixelIndex = offset / channels;
    const x = pixelIndex % image.width;
    const y = Math.floor(pixelIndex / image.width);
    if (alpha < max) hasTransparentPixel = true;
    if (alpha > visibleAlphaThreshold) {
      hasVisiblePixel = true;
      visiblePixelCount += 1;
      if (alpha === max) opaquePixelCount += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      const sample = Array.from(image.data.slice(offset, offset + channels)).join(",");
      visibleColors.add(sample);
    }
  }
  if (!hasVisiblePixel) invalid("PNG has no visible pixels");
  if (visibleColors.size < 2) invalid("PNG contains only a blank flat color");
  if (expectation.alpha === "required" && !hasTransparentPixel) invalid("PNG requires transparent background pixels");
  if (expectation.alpha === "forbidden" && hasTransparentPixel) invalid("PNG must be fully opaque");

  const digestBytes = new Uint8Array(bytes.byteLength);
  digestBytes.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", digestBytes);
  const sha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const alphaBounds = visiblePixelCount === 0 ? null : {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
  const boundsArea = alphaBounds ? alphaBounds.width * alphaBounds.height : 0;
  return {
    bytes,
    width: image.width,
    height: image.height,
    hasTransparency: hasTransparentPixel,
    sha256,
    alphaBounds,
    opaquePixelCount,
    visiblePixelCount,
    opaqueFillRatio: boundsArea > 0 ? opaquePixelCount / boundsArea : 0,
  };
}
