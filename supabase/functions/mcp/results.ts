import type { CallToolResult } from "@mcp/types.js";
import { asPublicMcpError } from "./errors.ts";

export type PageEnvelope<T> = { items: T[]; nextCursor: string | null };

export function toolSuccess(
  summary: string,
  structuredContent: Record<string, unknown>,
): CallToolResult {
  return {
    content: [{ type: "text", text: summary }],
    structuredContent,
  };
}

export function toolFailure(error: unknown): CallToolResult {
  const safe = asPublicMcpError(error);
  const detail: Record<string, unknown> = { code: safe.code, message: safe.message };
  if (safe.retryAfterSeconds !== undefined) {
    detail.retryAfterSeconds = safe.retryAfterSeconds;
  }
  return {
    content: [{ type: "text", text: safe.code + ": " + safe.message }],
    structuredContent: { ok: false, error: detail },
    isError: true,
  };
}
