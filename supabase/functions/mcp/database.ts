import type { ProjectMcpRequestContext } from "./context.ts";
import { McpDomainError } from "./errors.ts";
import { measureMcpPhase } from "./telemetry.ts";

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
  const rowOperations = new Set([
    "mcp_update_table_row",
    "mcp_delete_table_row",
    "mcp_bulk_update_table_rows",
    "mcp_upsert_table_rows",
  ]);
  const conflictOperations = new Set([
    "mcp_update_table_row",
    "mcp_delete_table_row",
    "mcp_delete_table_field",
    "mcp_edit_table_field",
    "mcp_delete_table",
    "mcp_bulk_update_table_rows",
    "mcp_upsert_table_rows",
  ]);
  const code = error.code === "42501"
    ? "PROJECT_ACCESS_REVOKED"
    : error.code === "PT409" && rowOperations.has(name)
    ? "ROW_CONFLICT"
    : error.code === "PT409" && conflictOperations.has(name)
    ? "FIELD_VALIDATION_FAILED"
    : error.code === "PT409"
    ? "DOCUMENT_CONFLICT"
    : error.code === "P0002" && rowOperations.has(name)
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
    : code === "FIELD_VALIDATION_FAILED"
    ? "The supplied field values are invalid."
    : "The Keco database operation failed.";
  throw new McpDomainError(code, message);
}
