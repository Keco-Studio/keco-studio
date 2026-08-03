import type { ProjectMcpRequestContext } from "./context.ts";
import { McpDomainError } from "./errors.ts";
import { measureMcpPhase } from "./telemetry.ts";

const ROW_OPERATIONS = new Set([
  "mcp_update_table_row",
  "mcp_delete_table_row",
  "mcp_bulk_update_table_rows",
  "mcp_upsert_table_rows",
]);

const FIELD_CONFLICT_OPERATIONS = new Set([
  "mcp_delete_table_field",
  "mcp_edit_table_field",
]);

function isTableMaintenancePrecondition(message: unknown): boolean {
  if (typeof message !== "string") return false;
  return /clearValues|clearReferences|confirmName|Existing match field values|Required field would be empty/i
    .test(message);
}

export async function rpc<T>(
  context: ProjectMcpRequestContext,
  name: string,
  parameters: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await measureMcpPhase(
    context,
    "database",
    async () => await context.supabase.rpc(name, parameters),
  );
  if (!error) return data as T;
  const preconditionFailed = error.code === "PT409" &&
    isTableMaintenancePrecondition(error.message);
  const code = error.code === "42501"
    ? "PROJECT_ACCESS_REVOKED"
    : preconditionFailed
    ? "FIELD_VALIDATION_FAILED"
    : error.code === "PT409" && ROW_OPERATIONS.has(name)
    ? "ROW_CONFLICT"
    : error.code === "PT409" && FIELD_CONFLICT_OPERATIONS.has(name)
    ? "FIELD_VALIDATION_FAILED"
    : error.code === "PT409"
    ? "DOCUMENT_CONFLICT"
    : error.code === "P0002" && ROW_OPERATIONS.has(name)
    ? "ROW_NOT_FOUND"
    : error.code === "P0002"
    ? "TABLE_NOT_FOUND"
    : error.code === "22023" || error.code === "23503" || error.code === "23505"
    ? "FIELD_VALIDATION_FAILED"
    : "INTERNAL_ERROR";
  const message = code === "PROJECT_ACCESS_REVOKED"
    ? "Project access has been revoked."
    : code === "DOCUMENT_CONFLICT"
    ? "The target changed; read it again before updating."
    : code === "ROW_CONFLICT"
    ? "The selected row changed; read the table rows again before updating."
    : code === "ROW_NOT_FOUND"
    ? "Row not found."
    : code === "TABLE_NOT_FOUND"
    ? "Table not found."
    : preconditionFailed
    ? "The table maintenance request is missing a required confirmation, clear flag, or stable match-field state."
    : code === "FIELD_VALIDATION_FAILED"
    ? "The supplied field values are invalid."
    : "The Keco database operation failed.";
  throw new McpDomainError(code, message);
}
