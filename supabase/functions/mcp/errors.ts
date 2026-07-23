export const MCP_ERROR_CODES = [
  "PROJECT_ACCESS_REVOKED",
  "PROJECT_NOT_ACCESSIBLE",
  "PROJECT_WRITE_FORBIDDEN",
  "WRITE_FORBIDDEN",
  "TABLE_NOT_FOUND",
  "ROW_NOT_FOUND",
  "ROW_CONFLICT",
  "DOCUMENT_NOT_FOUND",
  "FIELD_VALIDATION_FAILED",
  "DOCUMENT_CONFLICT",
  "INVALID_CURSOR",
  "INVALID_RESOURCE_URI",
  "PAYLOAD_TOO_LARGE",
  "RATE_LIMITED",
  "SEARCH_DEGRADED",
  "UPSTREAM_EMBEDDING_UNAVAILABLE",
  "INTERNAL_ERROR",
] as const;

export type McpErrorCode = typeof MCP_ERROR_CODES[number];

export class McpDomainError extends Error {
  readonly code: McpErrorCode;
  readonly retryAfterSeconds?: number;

  constructor(code: McpErrorCode, message: string, retryAfterSeconds?: number) {
    super(message);
    this.name = "McpDomainError";
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function asPublicMcpError(error: unknown): McpDomainError {
  return error instanceof McpDomainError
    ? error
    : new McpDomainError("INTERNAL_ERROR", "The Keco MCP operation failed.");
}
