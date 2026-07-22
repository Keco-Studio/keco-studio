import { McpDomainError } from "./errors.ts";

const CURSOR_VERSION = 1;
export const CURSOR_TTL_MS = 24 * 60 * 60 * 1000;
const encoder = new TextEncoder();

export type CursorEnvelope = {
  v: 1;
  kind: string;
  projectId: string;
  objectId: string | null;
  position: unknown;
  expiresAt: number;
};

export type CursorBinding = {
  kind: string;
  projectId: string;
  objectId?: string | null;
};

function invalidCursor(): never {
  throw new McpDomainError(
    "INVALID_CURSOR",
    "The pagination cursor is invalid or expired.",
  );
}

function base64UrlEncode(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function base64UrlDecode(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) invalidCursor();
  const padding = "=".repeat((4 - value.length % 4) % 4);
  try {
    const binary = atob(
      value.replaceAll("-", "+").replaceAll("_", "/") + padding,
    );
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    invalidCursor();
  }
}

async function hmac(secret: string, payload: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(
    await crypto.subtle.sign("HMAC", key, payload as unknown as BufferSource),
  );
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

function canonicalEnvelope(
  binding: CursorBinding,
  position: unknown,
  expiresAt: number,
): CursorEnvelope {
  return {
    v: CURSOR_VERSION,
    kind: binding.kind,
    projectId: binding.projectId,
    objectId: binding.objectId ?? null,
    position,
    expiresAt,
  };
}

export async function encodeCursor(
  binding: CursorBinding,
  position: unknown,
  secret: string,
  now = Date.now(),
): Promise<string> {
  if (!secret) throw new Error("MCP_CURSOR_SECRET is required.");
  const payload = encoder.encode(JSON.stringify(
    canonicalEnvelope(binding, position, now + CURSOR_TTL_MS),
  ));
  const signature = await hmac(secret, payload);
  return base64UrlEncode(payload) + "." + base64UrlEncode(signature);
}

export async function decodeCursor<T = unknown>(
  cursor: string,
  binding: CursorBinding,
  secret: string,
  now = Date.now(),
): Promise<T> {
  if (!secret) throw new Error("MCP_CURSOR_SECRET is required.");
  const parts = cursor.split(".");
  if (parts.length !== 2) invalidCursor();
  const payload = base64UrlDecode(parts[0]);
  const signature = base64UrlDecode(parts[1]);
  const expected = await hmac(secret, payload);
  if (!constantTimeEqual(signature, expected)) invalidCursor();

  let parsed: CursorEnvelope;
  try {
    parsed = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(payload),
    );
  } catch {
    invalidCursor();
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) invalidCursor();
  const canonical = canonicalEnvelope(
    { kind: parsed.kind, projectId: parsed.projectId, objectId: parsed.objectId },
    parsed.position,
    parsed.expiresAt,
  );
  if (
    JSON.stringify(parsed) !== JSON.stringify(canonical) ||
    parsed.v !== CURSOR_VERSION ||
    parsed.kind !== binding.kind ||
    parsed.projectId !== binding.projectId ||
    parsed.objectId !== (binding.objectId ?? null) ||
    !Number.isSafeInteger(parsed.expiresAt) ||
    parsed.expiresAt <= now
  ) invalidCursor();
  return parsed.position as T;
}
