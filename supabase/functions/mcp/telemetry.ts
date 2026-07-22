import type { McpRequestContext } from './context.ts';
import { asPublicMcpError, McpDomainError } from './errors.ts';
import { utf8ByteLength } from './limits.ts';

export type McpOperationClass = 'static' | 'read' | 'write' | 'search';

type Admission = {
  operation_id: string;
  remaining: number;
  reset_at: string;
};

function firstRow<T>(value: unknown): T | null {
  if (Array.isArray(value)) return (value[0] ?? null) as T | null;
  return value && typeof value === 'object' ? value as T : null;
}

async function responseByteLength(value: unknown): Promise<number> {
  if (value instanceof Response) {
    return (await value.clone().arrayBuffer()).byteLength;
  }
  return utf8ByteLength(JSON.stringify(value ?? null));
}

async function admit(
  context: McpRequestContext,
  operation: string,
  operationClass: McpOperationClass,
  requestBytes: number,
): Promise<Admission> {
  const { data, error } = await context.supabase.rpc('mcp_begin_operation', {
    p_project_id: context.projectId,
    p_operation: operation,
    p_operation_class: operationClass,
    p_request_id: context.requestId,
    p_client_id: context.clientId,
    p_request_bytes: requestBytes,
  });
  if (error) {
    throw new McpDomainError(
      error.code === '42501' ? 'PROJECT_ACCESS_REVOKED' : 'INTERNAL_ERROR',
      error.code === '42501'
        ? 'Project access has been revoked.'
        : 'The Keco operation could not be admitted.',
    );
  }
  const admission = firstRow<Admission>(data);
  if (!admission || typeof admission.operation_id !== 'string') {
    throw new McpDomainError('INTERNAL_ERROR', 'The Keco operation could not be admitted.');
  }
  if (admission.remaining < 0) {
    const resetMs = Date.parse(admission.reset_at);
    const retryAfter = Number.isFinite(resetMs)
      ? Math.max(1, Math.ceil((resetMs - Date.now()) / 1000))
      : 60;
    throw new McpDomainError('RATE_LIMITED', 'Too many Keco MCP requests.', retryAfter);
  }
  return admission;
}

async function complete(
  context: McpRequestContext,
  operationId: string,
  outcome: 'succeeded' | 'failed',
  errorCode: string | null,
  responseBytes: number | null,
  totalMs: number,
): Promise<boolean> {
  const { error } = await context.supabase.rpc('mcp_complete_operation', {
    p_operation_id: operationId,
    p_outcome: outcome,
    p_error_code: errorCode,
    p_response_bytes: responseBytes,
    p_total_ms: totalMs,
    p_database_ms: null,
    p_embedding_ms: null,
    p_serialization_ms: null,
    p_metadata: {},
  });
  return !error;
}

async function opaqueId(value: string): Promise<string> {
  const salt = Deno.env.get('MCP_CURSOR_SECRET') ?? 'keco-mcp-telemetry';
  const digest = await crypto.subtle.digest(
    'SHA-256', new TextEncoder().encode(salt + '\0' + value),
  );
  return Array.from(new Uint8Array(digest).slice(0, 12), byte =>
    byte.toString(16).padStart(2, '0')).join('');
}

async function emitTelemetry(context: McpRequestContext, value: Record<string, unknown>): Promise<void> {
  console.log(JSON.stringify({ event: 'keco_mcp_operation', requestId: context.requestId,
    actorHash: await opaqueId(context.userId), projectHash: await opaqueId(context.projectId),
    role: context.role, ...value }));
}

export async function runMcpOperation<T>(
  context: McpRequestContext,
  operation: string,
  operationClass: McpOperationClass,
  input: unknown,
  callback: () => Promise<T>,
): Promise<T> {
  const requestBytes = utf8ByteLength(JSON.stringify(input ?? {}));
  const startedAt = performance.now();
  const admission = await admit(context, operation, operationClass, requestBytes);
  try {
    const result = await callback();
    const responseBytes = await responseByteLength(result);
    const totalMs = Math.max(0, Math.round(performance.now() - startedAt));
    const completionRecorded = await complete(
      context, admission.operation_id, 'succeeded', null, responseBytes, totalMs,
    );
    await emitTelemetry(context, {
      operation, operationClass, outcome: 'succeeded', totalMs, responseBytes,
      completionRecorded });
    return result;
  } catch (error) {
    const safe = asPublicMcpError(error);
    const totalMs = Math.max(0, Math.round(performance.now() - startedAt));
    const completionRecorded = await complete(
      context, admission.operation_id, 'failed', safe.code, null, totalMs,
    ).catch(() => false);
    await emitTelemetry(context, {
      operation, operationClass, outcome: 'failed', errorCode: safe.code, totalMs,
      completionRecorded });
    throw error;
  }
}
