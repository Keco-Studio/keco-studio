import { PixelLabMapError } from "./types.ts";

const MAX_BODY_BYTES = 64 * 1024;

export function corsHeaders(): Headers {
  return new Headers({
    "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-origin": "*",
    "content-type": "application/json",
  });
}

export function jsonResponse(body: unknown, status = 200): Response {
  const headers = corsHeaders();
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers });
}

export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) throw new PixelLabMapError("pixellab_invalid_response", "Request body too large", 413);
  const bytes = new TextEncoder().encode(await request.text());
  if (bytes.byteLength > MAX_BODY_BYTES) throw new PixelLabMapError("pixellab_invalid_response", "Request body too large", 413);
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new PixelLabMapError("pixellab_invalid_response", "Invalid request body", 400);
  }
}

export function bearerToken(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new PixelLabMapError("pixellab_invalid_response", "Authentication required", 401);
  return match[1];
}
