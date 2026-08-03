import { assertEquals, assertRejects } from "@std/assert";
import type { ProjectMcpRequestContext } from "./context.ts";
import { rpc } from "./database.ts";
import { McpDomainError } from "./errors.ts";

function contextWithError(
  code: string,
  message = "database failed",
): ProjectMcpRequestContext {
  const value = {
    supabase: {
      rpc: () => Promise.resolve({ data: null, error: { code, message } }),
    },
  };
  return value as unknown as ProjectMcpRequestContext;
}

Deno.test("database maps table-row and document PT409 conflicts distinctly", async () => {
  const rowError = await assertRejects(
    () => rpc(contextWithError("PT409"), "mcp_update_table_row", {}),
    McpDomainError,
  );
  assertEquals(rowError.code, "ROW_CONFLICT");
  assertEquals(
    rowError.message,
    "The selected row changed; read the table rows again before updating.",
  );

  const documentError = await assertRejects(
    () => rpc(contextWithError("PT409"), "mcp_replace_document_content", {}),
    McpDomainError,
  );
  assertEquals(documentError.code, "DOCUMENT_CONFLICT");
});

Deno.test("database maps table maintenance preconditions without row drift guidance", async () => {
  const referenceError = await assertRejects(
    () =>
      rpc(
        contextWithError(
          "PT409",
          "Row is referenced; clearReferences is required",
        ),
        "mcp_delete_table_row",
        {},
      ),
    McpDomainError,
  );
  assertEquals(referenceError.code, "FIELD_VALIDATION_FAILED");
  assertEquals(
    referenceError.message,
    "The table maintenance request is missing a required confirmation, clear flag, or stable match-field state.",
  );
});
