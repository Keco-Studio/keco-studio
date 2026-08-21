import type { McpRequestContext } from "./context.ts";
import {
  isMcpErrorCode,
  McpDomainError,
  type McpErrorCode,
} from "./errors.ts";

const MAX_APP_RESPONSE_BYTES = 256 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;
const decoder = new TextDecoder("utf-8", { fatal: true });

export type KecoAppRequest = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: `/${string}`;
  body?: unknown;
  idempotencyKey?: string;
};

type AppBridgeDependencies = {
  fetch?: typeof fetch;
  origin?: string;
  timeoutMs?: number;
};

function appOrigin(configured?: string): URL {
  const raw = configured ?? Deno.env.get("KECO_PUBLIC_URL");
  if (!raw) {
    throw new McpDomainError(
      "UPSTREAM_UNAVAILABLE",
      "The Keco application service is unavailable.",
      undefined,
      true,
    );
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new McpDomainError(
      "UPSTREAM_UNAVAILABLE",
      "The Keco application service is unavailable.",
      undefined,
      true,
    );
  }
  const localHttp = url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1" ||
      url.hostname === "[::1]");
  if ((url.protocol !== "https:" && !localHttp) || url.username || url.password) {
    throw new McpDomainError(
      "UPSTREAM_UNAVAILABLE",
      "The Keco application service is unavailable.",
      undefined,
      true,
    );
  }
  return url;
}

async function readBoundedBody(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared >= MAX_APP_RESPONSE_BYTES) {
    throw new McpDomainError(
      "PAYLOAD_TOO_LARGE",
      "The Keco application response exceeded the MCP bridge limit.",
    );
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total >= MAX_APP_RESPONSE_BYTES) {
        await reader.cancel();
        throw new McpDomainError(
          "PAYLOAD_TOO_LARGE",
          "The Keco application response exceeded the MCP bridge limit.",
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return decoder.decode(bytes);
  } catch {
    throw new McpDomainError(
      "UPSTREAM_UNAVAILABLE",
      "The Keco application returned an invalid response.",
      undefined,
      true,
    );
  }
}

function safeMessage(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const message = value.trim();
  if (!message || message.length > 500 ||
    /https?:|bearer|token|secret|password|authorization/i.test(message)) {
    return fallback;
  }
  return message;
}

function fallbackCode(status: number): McpErrorCode {
  if (status === 400 || status === 422) return "FIELD_VALIDATION_FAILED";
  if (status === 401 || status === 404) return "PROJECT_NOT_ACCESSIBLE";
  if (status === 403) return "PROJECT_WRITE_FORBIDDEN";
  if (status === 409) return "IDEMPOTENCY_CONFLICT";
  if (status === 429) return "RATE_LIMITED";
  return "UPSTREAM_UNAVAILABLE";
}

function appFailure(response: Response, parsed: unknown): McpDomainError {
  const record = parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {};
  const code = isMcpErrorCode(record.code)
    ? record.code
    : fallbackCode(response.status);
  const retryable = response.status === 429 || response.status >= 500 ||
    code === "UPSTREAM_UNAVAILABLE" || code === "PROVIDER_RATE_LIMITED";
  return new McpDomainError(
    code,
    safeMessage(
      record.error ?? record.message,
      retryable
        ? "The Keco application service is temporarily unavailable."
        : "The Keco application request was rejected.",
    ),
    undefined,
    retryable,
  );
}

export async function callKecoApp<T>(
  context: McpRequestContext,
  request: KecoAppRequest,
  dependencies: AppBridgeDependencies = {},
): Promise<T> {
  const url = new URL(request.path, appOrigin(dependencies.origin));
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    dependencies.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  const headers = new Headers({
    authorization: "Bearer " + context.bearerToken,
    accept: "application/json",
  });
  let body: string | undefined;
  if (request.body !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(request.body);
  }
  if (request.idempotencyKey) {
    headers.set("idempotency-key", request.idempotencyKey);
  }
  try {
    const response = await (dependencies.fetch ?? fetch)(url, {
      method: request.method,
      headers,
      body,
      signal: controller.signal,
    });
    const text = await readBoundedBody(response);
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        if (response.ok) {
          throw new McpDomainError(
            "UPSTREAM_UNAVAILABLE",
            "The Keco application returned an invalid response.",
            undefined,
            true,
          );
        }
      }
    }
    if (!response.ok) throw appFailure(response, parsed);
    if (!parsed || typeof parsed !== "object") {
      throw new McpDomainError(
        "UPSTREAM_UNAVAILABLE",
        "The Keco application returned an invalid response.",
        undefined,
        true,
      );
    }
    return parsed as T;
  } catch (error) {
    if (error instanceof McpDomainError) throw error;
    throw new McpDomainError(
      "UPSTREAM_UNAVAILABLE",
      "The Keco application service is temporarily unavailable.",
      undefined,
      true,
    );
  } finally {
    clearTimeout(timeout);
  }
}
