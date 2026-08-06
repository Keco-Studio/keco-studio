import { McpDomainError } from "./errors.ts";

export const MAX_REQUEST_BYTES = 256 * 1024;
export const MAX_RESPONSE_BYTES = 1024 * 1024;
export const MAX_STORY_GRAPH_RESULT_BYTES = MAX_RESPONSE_BYTES - 64 * 1024;
export const MAX_DOCUMENT_MARKDOWN_BYTES = 100 * 1024;
export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 200;
export const DEFAULT_SEARCH_LIMIT = 10;
export const MAX_SEARCH_LIMIT = 30;

const encoder = new TextEncoder();

export function utf8ByteLength(value: string): number {
  return encoder.encode(value).byteLength;
}

export function validateLimit(
  value: unknown,
  options: { defaultValue: number; maximum: number; name?: string },
): number {
  if (value === undefined) return options.defaultValue;
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > options.maximum) {
    throw new McpDomainError(
      "FIELD_VALIDATION_FAILED",
      (options.name ?? "limit") + " must be an integer between 1 and " +
        options.maximum + ".",
    );
  }
  return value as number;
}

export function assertUtf8Below(value: string, maximum: number, label: string): void {
  if (utf8ByteLength(value) >= maximum) {
    throw new McpDomainError(
      "PAYLOAD_TOO_LARGE",
      label + " must remain below " + maximum + " bytes.",
    );
  }
}
