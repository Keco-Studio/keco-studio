import { MAX_PNG_BYTES, packHorizontal } from "./png.ts";
import { PixelLabCharacterError } from "./types.ts";

async function download(url: string, fetcher: typeof fetch): Promise<Uint8Array> {
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new PixelLabCharacterError("pixellab_invalid_response", "Provider image URL is invalid", 422); }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new PixelLabCharacterError("pixellab_invalid_response", "Provider image URL is invalid", 422);
  const response = await fetcher(parsed.toString());
  if (!response.ok) throw new PixelLabCharacterError("pixellab_upstream", "Provider image download failed");
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_PNG_BYTES) throw new PixelLabCharacterError("pixellab_invalid_response", "Provider image is too large", 422);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.byteLength || bytes.byteLength > MAX_PNG_BYTES) throw new PixelLabCharacterError("pixellab_invalid_response", "Provider image is too large", 422);
  return bytes;
}

export async function downloadProviderOutput(
  result: { imageUrl: string | null; frameUrls: string[] },
  fetcher: typeof fetch = fetch,
): Promise<Uint8Array> {
  if (result.imageUrl) return download(result.imageUrl, fetcher);
  if (!result.frameUrls.length || result.frameUrls.length > 16) throw new PixelLabCharacterError("pixellab_invalid_response", "Provider animation frames are missing", 422);
  const frames: Uint8Array[] = [];
  for (const url of result.frameUrls) frames.push(await download(url, fetcher));
  return packHorizontal(frames);
}
