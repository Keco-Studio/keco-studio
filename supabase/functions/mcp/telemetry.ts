import type { McpRequestContext, ProjectMcpRequestContext } from "./context.ts";
import { asPublicMcpError, McpDomainError } from "./errors.ts";
import { MAX_RESPONSE_BYTES, utf8ByteLength } from "./limits.ts";

export type McpOperationClass = "static" | "read" | "write" | "search";
export type McpOperationPhase = "database" | "embedding";

type PhaseTimings = { databaseMs: number; embeddingMs: number };
const phaseTimings = new WeakMap<McpRequestContext, PhaseTimings>();

function resetPhaseTimings(context: McpRequestContext): PhaseTimings {
  const timings = { databaseMs: 0, embeddingMs: 0 };
  phaseTimings.set(context, timings);
  return timings;
}

export function inheritMcpPhaseTimings(
  parent: McpRequestContext,
  child: McpRequestContext,
): void {
  phaseTimings.set(
    child,
    phaseTimings.get(parent) ?? resetPhaseTimings(parent),
  );
}

export async function measureMcpPhase<T>(
  context: McpRequestContext,
  phase: McpOperationPhase,
  callback: () => Promise<T>,
): Promise<T> {
  const startedAt = performance.now();
  try {
    return await callback();
  } finally {
    const timings = phaseTimings.get(context) ?? resetPhaseTimings(context);
    const elapsed = Math.max(0, performance.now() - startedAt);
    if (phase === "database") timings.databaseMs += elapsed;
    else timings.embeddingMs += elapsed;
  }
}

type Admission = {
  operation_id: string;
  remaining: number;
  reset_at: string;
};

function firstRow<T>(value: unknown): T | null {
  if (Array.isArray(value)) return (value[0] ?? null) as T | null;
  return value && typeof value === "object" ? value as T : null;
}

async function responseByteLength(value: unknown): Promise<number> {
  if (value instanceof Response) {
    return (await value.clone().arrayBuffer()).byteLength;
  }
  return utf8ByteLength(JSON.stringify(value ?? null));
}

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The bounded public error replaces this response.
  }
}

async function admitProtocolResponse(
  response: Response,
): Promise<{ response: Response; responseBytes: number }> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared >= MAX_RESPONSE_BYTES) {
    await cancelResponseBody(response);
    throw new McpDomainError(
      "PAYLOAD_TOO_LARGE",
      "The MCP response must remain below 1 MiB.",
    );
  }
  if (!response.body) return { response, responseBytes: 0 };

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let responseBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      if (responseBytes + value.byteLength >= MAX_RESPONSE_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // The bounded public error still wins over cancellation failure.
        }
        throw new McpDomainError(
          "PAYLOAD_TOO_LARGE",
          "The MCP response must remain below 1 MiB.",
        );
      }
      responseBytes += value.byteLength;
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof McpDomainError) throw error;
    try {
      await reader.cancel();
    } catch {
      // The safe internal error below replaces the unreadable response.
    }
    throw new McpDomainError(
      "INTERNAL_ERROR",
      "The MCP response could not be serialized.",
    );
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(responseBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const headers = new Headers(response.headers);
  headers.set("content-length", String(responseBytes));
  return {
    response: new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    }),
    responseBytes,
  };
}

async function admit(
  context: McpRequestContext,
  operation: string,
  operationClass: McpOperationClass,
  requestBytes: number,
): Promise<Admission> {
  const { data, error } = context.mode === "account"
    ? await context.supabase.rpc("mcp_begin_account_operation", {
      p_operation: operation,
      p_operation_class: operationClass,
      p_request_id: context.requestId,
      p_client_id: context.clientId,
      p_request_bytes: requestBytes,
    })
    : await context.supabase.rpc("mcp_begin_operation", {
      p_project_id: context.projectId,
      p_operation: operation,
      p_operation_class: operationClass,
      p_request_id: context.requestId,
      p_client_id: context.clientId,
      p_request_bytes: requestBytes,
    });
  if (error) {
    const projectRevoked = context.mode === "project" && error.code === "42501";
    throw new McpDomainError(
      projectRevoked ? "PROJECT_ACCESS_REVOKED" : "INTERNAL_ERROR",
      projectRevoked
        ? "Project access has been revoked."
        : "The Keco operation could not be admitted.",
    );
  }
  const admission = firstRow<Admission>(data);
  if (!admission || typeof admission.operation_id !== "string") {
    throw new McpDomainError(
      "INTERNAL_ERROR",
      "The Keco operation could not be admitted.",
    );
  }
  if (admission.remaining < 0) {
    const resetMs = Date.parse(admission.reset_at);
    const retryAfter = Number.isFinite(resetMs)
      ? Math.max(1, Math.ceil((resetMs - Date.now()) / 1000))
      : 60;
    throw new McpDomainError(
      "RATE_LIMITED",
      "Too many Keco MCP requests.",
      retryAfter,
    );
  }
  return admission;
}

async function complete(
  context: McpRequestContext,
  operationId: string,
  outcome: "succeeded" | "failed",
  errorCode: string | null,
  responseBytes: number | null,
  totalMs: number,
  databaseMs: number | null = null,
  embeddingMs: number | null = null,
  serializationMs: number | null = null,
  metadata: Record<string, unknown> = {},
): Promise<boolean> {
  const { error } = await context.supabase.rpc("mcp_complete_operation", {
    p_operation_id: operationId,
    p_outcome: outcome,
    p_error_code: errorCode,
    p_response_bytes: responseBytes,
    p_total_ms: totalMs,
    p_database_ms: databaseMs,
    p_embedding_ms: embeddingMs,
    p_serialization_ms: serializationMs,
    p_metadata: metadata,
  });
  return !error;
}

type ProtocolOutcome = {
  failed: boolean;
  errorCode: string | null;
  metadata: Record<string, unknown>;
};

function stableCode(value: unknown): string | null {
  return typeof value === "string" && /^[A-Z][A-Z0-9_]{0,99}$/.test(value)
    ? value
    : null;
}

async function inspectProtocolOutcome(
  response: Response,
): Promise<ProtocolOutcome> {
  try {
    const body = await response.clone().json() as Record<string, unknown>;
    const rpcError = body?.error as Record<string, unknown> | undefined;
    if (rpcError) {
      const data = rpcError.data as Record<string, unknown> | undefined;
      return {
        failed: true,
        errorCode: stableCode(data?.code) ?? "PROTOCOL_ERROR",
        metadata: {},
      };
    }
    const result = body?.result as Record<string, unknown> | undefined;
    const structured = result?.structuredContent as
      | Record<string, unknown>
      | undefined;
    const toolError = structured?.error as Record<string, unknown> | undefined;
    const metadata: Record<string, unknown> = {};
    if (
      structured?.searchMode === "semantic" ||
      structured?.searchMode === "text_fuzzy"
    ) {
      metadata.searchMode = structured.searchMode;
    }
    if (
      typeof structured?.degradationReason === "string" &&
      /^[a-z][a-z0-9_]{0,99}$/.test(structured.degradationReason)
    ) {
      metadata.degradationReason = structured.degradationReason;
    }
    return {
      failed: result?.isError === true,
      errorCode: result?.isError === true
        ? stableCode(toolError?.code) ?? "TOOL_ERROR"
        : null,
      metadata,
    };
  } catch {
    return {
      failed: response.status >= 400,
      errorCode: response.status >= 400 ? "PROTOCOL_ERROR" : null,
      metadata: {},
    };
  }
}

async function opaqueId(value: string): Promise<string> {
  const salt = Deno.env.get("MCP_CURSOR_SECRET") ?? "keco-mcp-telemetry";
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(salt + "\0" + value),
  );
  return Array.from(
    new Uint8Array(digest).slice(0, 12),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function emitTelemetry(
  context: McpRequestContext,
  value: Record<string, unknown>,
): Promise<void> {
  if (context.mode === "account") {
    console.log(
      JSON.stringify({
        event: "keco_mcp_operation",
        requestId: context.requestId,
        actorHash: await opaqueId(context.userId),
        ...value,
      }),
    );
    return;
  }
  console.log(
    JSON.stringify({
      event: "keco_mcp_operation",
      requestId: context.requestId,
      actorHash: await opaqueId(context.userId),
      projectHash: await opaqueId(context.projectId),
      role: context.role,
      ...value,
    }),
  );
}

export async function runMcpOperation<T>(
  context: ProjectMcpRequestContext,
  operation: string,
  operationClass: McpOperationClass,
  input: unknown,
  callback: () => Promise<T>,
): Promise<T> {
  const requestBytes = utf8ByteLength(JSON.stringify(input ?? {}));
  const startedAt = performance.now();
  const timings = resetPhaseTimings(context);
  const admission = await admit(
    context,
    operation,
    operationClass,
    requestBytes,
  );
  try {
    const result = await callback();
    const admittedResult = result instanceof Response
      ? (await admitProtocolResponse(result)).response as T
      : result;
    const responseBytes = await responseByteLength(admittedResult);
    if (responseBytes >= MAX_RESPONSE_BYTES) {
      throw new McpDomainError(
        "PAYLOAD_TOO_LARGE",
        "The MCP response must remain below 1 MiB.",
      );
    }
    const totalMs = Math.max(0, Math.round(performance.now() - startedAt));
    const databaseMs = Math.round(timings.databaseMs);
    const embeddingMs = Math.round(timings.embeddingMs);
    const completionRecorded = await complete(
      context,
      admission.operation_id,
      "succeeded",
      null,
      responseBytes,
      totalMs,
      databaseMs,
      embeddingMs,
    );
    await emitTelemetry(context, {
      operation,
      operationClass,
      outcome: "succeeded",
      totalMs,
      responseBytes,
      databaseMs,
      embeddingMs,
      completionRecorded,
    });
    return admittedResult;
  } catch (error) {
    const safe = asPublicMcpError(error);
    const totalMs = Math.max(0, Math.round(performance.now() - startedAt));
    const databaseMs = Math.round(timings.databaseMs);
    const embeddingMs = Math.round(timings.embeddingMs);
    const completionRecorded = await complete(
      context,
      admission.operation_id,
      "failed",
      safe.code,
      null,
      totalMs,
      databaseMs,
      embeddingMs,
    ).catch(() => false);
    await emitTelemetry(context, {
      operation,
      operationClass,
      outcome: "failed",
      errorCode: safe.code,
      totalMs,
      databaseMs,
      embeddingMs,
      completionRecorded,
    });
    throw error;
  }
}

export async function runMcpProtocolOperation(
  context: McpRequestContext,
  descriptor: {
    operation: string;
    operationClass: McpOperationClass;
    requestBytes: number;
  },
  callback: () => Promise<Response>,
): Promise<Response> {
  const startedAt = performance.now();
  const timings = resetPhaseTimings(context);
  const admission = await admit(
    context,
    descriptor.operation,
    descriptor.operationClass,
    descriptor.requestBytes,
  );
  try {
    const response = await callback();
    const serializationStarted = performance.now();
    const admittedResponse = await admitProtocolResponse(response);
    const responseBytes = admittedResponse.responseBytes;
    const outcome = await inspectProtocolOutcome(admittedResponse.response);
    const serializationMs = Math.max(
      0,
      Math.round(performance.now() - serializationStarted),
    );
    const totalMs = Math.max(0, Math.round(performance.now() - startedAt));
    const databaseMs = Math.round(timings.databaseMs);
    const embeddingMs = Math.round(timings.embeddingMs);
    const completionRecorded = await complete(
      context,
      admission.operation_id,
      outcome.failed ? "failed" : "succeeded",
      outcome.errorCode,
      responseBytes,
      totalMs,
      databaseMs,
      embeddingMs,
      serializationMs,
      outcome.metadata,
    );
    await emitTelemetry(context, {
      operation: descriptor.operation,
      operationClass: descriptor.operationClass,
      outcome: outcome.failed ? "failed" : "succeeded",
      errorCode: outcome.errorCode,
      totalMs,
      databaseMs,
      embeddingMs,
      serializationMs,
      responseBytes,
      ...outcome.metadata,
      completionRecorded,
    });
    return admittedResponse.response;
  } catch (error) {
    const safe = asPublicMcpError(error);
    const totalMs = Math.max(0, Math.round(performance.now() - startedAt));
    const databaseMs = Math.round(timings.databaseMs);
    const embeddingMs = Math.round(timings.embeddingMs);
    const completionRecorded = await complete(
      context,
      admission.operation_id,
      "failed",
      safe.code,
      null,
      totalMs,
      databaseMs,
      embeddingMs,
    ).catch(() => false);
    await emitTelemetry(context, {
      operation: descriptor.operation,
      operationClass: descriptor.operationClass,
      outcome: "failed",
      errorCode: safe.code,
      totalMs,
      databaseMs,
      embeddingMs,
      completionRecorded,
    });
    throw error;
  }
}
