export const MCP_ERROR_CODES = [
  "PROJECT_ACCESS_REVOKED",
  "PROJECT_NOT_ACCESSIBLE",
  "PROJECT_WRITE_FORBIDDEN",
  "WRITE_FORBIDDEN",
  "TABLE_NOT_FOUND",
  "ROW_NOT_FOUND",
  "ROW_CONFLICT",
  "DOCUMENT_NOT_FOUND",
  "FOLDER_NOT_FOUND",
  "FOLDER_NAME_CONFLICT",
  "FIELD_VALIDATION_FAILED",
  "DOCUMENT_CONFLICT",
  "STORY_GRAPH_UNSUPPORTED_LIBRARY",
  "STORY_GRAPH_INVALID_SNAPSHOT",
  "STORY_GRAPH_CONFLICT",
  "GDS_NOT_FOUND",
  "GDS_JOB_CONFLICT",
  "IDEMPOTENCY_CONFLICT",
  "MAP_NOT_FOUND",
  "MAP_REVISION_STALE",
  "MAP_CONFIRMATION_REQUIRED",
  "MAP_CONFIRMATION_EXPIRED",
  "MAP_CONFIRMATION_MISMATCH",
  "MAP_GENERATION_BLOCKED",
  "MAP_GENERATION_FAILED",
  "PROVIDER_RATE_LIMITED",
  "PROVIDER_QUOTA_EXCEEDED",
  "UPSTREAM_UNAVAILABLE",
  "INVALID_CURSOR",
  "INVALID_RESOURCE_URI",
  "PAYLOAD_TOO_LARGE",
  "IMAGE_UPLOAD_PREPARATION_FAILED",
  "IMAGE_UPLOAD_NOT_FOUND",
  "RATE_LIMITED",
  "SEARCH_DEGRADED",
  "UPSTREAM_EMBEDDING_UNAVAILABLE",
  "INTERNAL_ERROR",
] as const;

export type McpErrorCode = typeof MCP_ERROR_CODES[number];

export class McpDomainError extends Error {
  readonly code: McpErrorCode;
  readonly retryAfterSeconds?: number;
  readonly retryable?: boolean;

  constructor(
    code: McpErrorCode,
    message: string,
    retryAfterSeconds?: number,
    retryable?: boolean,
  ) {
    super(message);
    this.name = "McpDomainError";
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
    this.retryable = retryable;
  }
}

export function isMcpErrorCode(value: unknown): value is McpErrorCode {
  return typeof value === "string" &&
    (MCP_ERROR_CODES as readonly string[]).includes(value);
}

export function asPublicMcpError(error: unknown): McpDomainError {
  return error instanceof McpDomainError
    ? error
    : new McpDomainError("INTERNAL_ERROR", "The Keco MCP operation failed.");
}
