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

const SLICE_OPERATIONS = new Set([
  "mcp_create_slice_bundle_v2",
  "mcp_read_slice_run",
  "mcp_read_slice_run_contract_version",
  "mcp_checkpoint_slice_v2",
  "mcp_prepare_slice_delivery_v2",
  "mcp_finalize_slice_v2",
  "mcp_export_slice_mirrors_v2",
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
  const code = error.code === "KS409"
    ? "IDEMPOTENCY_CONFLICT"
    : error.code === "KS410"
    ? "SLICE_STATE_CONFLICT"
    : error.code === "KS411"
    ? "SLICE_REPAIR_LIMIT"
    : error.code === "KS412"
    ? "SLICE_FINALIZATION_BLOCKED"
    : error.code === "42501"
    ? "PROJECT_ACCESS_REVOKED"
    : error.code === "22023" && SLICE_OPERATIONS.has(name)
    ? "SLICE_CONTRACT_INVALID"
    : error.code === "PT409" &&
        name === "mcp_finalize_slice_v2"
    ? "SLICE_MIRROR_MISMATCH"
    : preconditionFailed
    ? "FIELD_VALIDATION_FAILED"
    : error.code === "PT409" && ROW_OPERATIONS.has(name)
    ? "ROW_CONFLICT"
    : error.code === "PT409" && FIELD_CONFLICT_OPERATIONS.has(name)
    ? "FIELD_VALIDATION_FAILED"
    : error.code === "PT409"
    ? "DOCUMENT_CONFLICT"
    : error.code === "P0002" && SLICE_OPERATIONS.has(name)
    ? "SLICE_STATE_CONFLICT"
    : error.code === "P0002" && ROW_OPERATIONS.has(name)
    ? "ROW_NOT_FOUND"
    : error.code === "P0002"
    ? "TABLE_NOT_FOUND"
    : error.code === "22023" || error.code === "23503" || error.code === "23505"
    ? "FIELD_VALIDATION_FAILED"
    : "INTERNAL_ERROR";
  const message = code === "IDEMPOTENCY_CONFLICT"
    ? "This idempotency key was already used with different Slice inputs."
    : code === "SLICE_STATE_CONFLICT"
    ? "The Slice state changed; read the current run before continuing."
    : code === "SLICE_REPAIR_LIMIT"
    ? "The Slice repair limit has been reached."
    : code === "SLICE_MIRROR_MISMATCH"
    ? "The verified Slice mirrors no longer match the authoritative documents."
    : code === "SLICE_FINALIZATION_BLOCKED"
    ? "The Slice does not satisfy the finalization gates."
    : code === "SLICE_CONTRACT_INVALID"
    ? "The Slice request does not satisfy the deterministic contract."
    : code === "PROJECT_ACCESS_REVOKED"
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
