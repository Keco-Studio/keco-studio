import type { McpServer } from "@mcp/server/mcp.js";
import { z } from "zod";
import type { ProjectMcpRequestContext } from "./context.ts";
import { rpc } from "./database.ts";
import { toolFailure, toolSuccess } from "./results.ts";
import { createClient } from "@supabase/supabase-js";
import {
  encodeDocumentMarkdown,
  normalizeDocumentState,
} from "./document-codec.ts";
import { readDocumentTransportState } from "./operations.ts";
import { McpDomainError } from "./errors.ts";
import { MAX_DOCUMENT_MARKDOWN_BYTES, utf8ByteLength } from "./limits.ts";
import { scheduleMcpReindex } from "./reindex.ts";
import { measureMcpPhase } from "./telemetry.ts";

const uuid = z.string().uuid();
const writeAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};
const fieldSchema = z.object({
  label: z.string().trim().min(1).max(200),
  dataType: z.enum([
    "string",
    "string_array",
    "int",
    "int_array",
    "float",
    "float_array",
    "boolean",
    "enum",
    "date",
    "reference",
  ]),
  section: z.string().trim().min(1).max(100).optional(),
  sectionId: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(1000).nullable().optional(),
  required: z.boolean().optional(),
  enumOptions: z.array(z.string().trim().min(1).max(200)).min(1).max(100)
    .optional(),
  referenceTableIds: z.array(uuid).min(1).max(20).optional(),
}).strict().superRefine((field, issue) => {
  if (field.dataType === "enum" && !field.enumOptions) {
    issue.addIssue({
      code: "custom",
      message: "enumOptions are required for enum fields.",
    });
  }
  if (field.dataType !== "enum" && field.enumOptions) {
    issue.addIssue({
      code: "custom",
      message: "enumOptions require an enum field.",
    });
  }
  if (field.dataType === "reference" && !field.referenceTableIds) {
    issue.addIssue({
      code: "custom",
      message: "referenceTableIds are required for reference fields.",
    });
  }
  if (field.dataType !== "reference" && field.referenceTableIds) {
    issue.addIssue({
      code: "custom",
      message: "referenceTableIds require a reference field.",
    });
  }
});

async function executeRpc(
  context: ProjectMcpRequestContext,
  operation: string,
  parameters: Record<string, unknown>,
  _publicInput: unknown,
  summary: string,
  onSuccess?: (data: unknown) => void,
) {
  try {
    const data = await rpc<unknown>(context, operation, parameters);
    onSuccess?.(data);
    return toolSuccess(summary, { ok: true, data });
  } catch (error) {
    return toolFailure(error);
  }
}

function firstRow(value: unknown): Record<string, unknown> | null {
  const row = Array.isArray(value) ? value[0] : value;
  return row && typeof row === "object" && !Array.isArray(row)
    ? row as Record<string, unknown>
    : null;
}

function assertDocumentMarkdownSize(markdown: string): void {
  if (utf8ByteLength(markdown) > MAX_DOCUMENT_MARKDOWN_BYTES) {
    throw new McpDomainError(
      "PAYLOAD_TOO_LARGE",
      "Document Markdown must be at most 100 KiB.",
    );
  }
}

export function registerWriteTools(
  server: McpServer,
  context: ProjectMcpRequestContext,
): void {
  if (context.role === "viewer") return;

  const createTableSchema = z.object({
    name: z.string().trim().min(1).max(200),
    description: z.string().max(2000).nullable().optional(),
    folderId: uuid.nullable().optional(),
    fields: z.array(fieldSchema).min(1).max(100),
  }).strict();
  server.registerTool("create_table", {
    description:
      "Create one project table, its fields, and initial empty row atomically.",
    inputSchema: createTableSchema,
    annotations: writeAnnotations,
  }, async (input: z.infer<typeof createTableSchema>) => {
    const tableId = crypto.randomUUID();
    const fields = input.fields.map((field) => ({
      id: crypto.randomUUID(),
      ...field,
    }));
    return await executeRpc(
      context,
      "mcp_create_table",
      {
        p_project_id: context.projectId,
        p_table_id: tableId,
        p_initial_row_id: crypto.randomUUID(),
        p_folder_id: input.folderId ?? null,
        p_name: input.name,
        p_description: input.description ?? null,
        p_fields: fields,
      },
      input,
      "Table created.",
      () =>
        scheduleMcpReindex({
          kind: "table",
          projectId: context.projectId,
          actorUserId: context.userId,
          tableId,
        }),
    );
  });

  const createRowSchema = z.object({
    tableId: uuid,
    values: z.record(z.string().trim().min(1).max(200), z.unknown()).refine(
      (value) =>
        Object.keys(value).length > 0 && Object.keys(value).length <= 100,
      "values must contain between 1 and 100 fields.",
    ),
    reuseEmpty: z.boolean().optional(),
  }).strict();
  server.registerTool("create_table_row", {
    description: "Create or reuse one project table row atomically.",
    inputSchema: createRowSchema,
    annotations: writeAnnotations,
  }, async (input: z.infer<typeof createRowSchema>) =>
    executeRpc(
      context,
      "mcp_create_table_row",
      {
        p_project_id: context.projectId,
        p_table_id: input.tableId,
        p_requested_row_id: crypto.randomUUID(),
        p_values: input.values,
        p_reuse_empty: input.reuseEmpty ?? true,
      },
      input,
      "Table row created.",
      (data) => {
        const rowId = firstRow(data)?.row_id;
        if (typeof rowId === "string") {
          scheduleMcpReindex({
            kind: "row",
            projectId: context.projectId,
            actorUserId: context.userId,
            rowId,
          });
        }
      },
    ));

  const updateRowSchema = z.object({
    tableId: uuid,
    rowId: uuid.optional(),
    rowIndex: z.number().int().min(1).optional(),
    expectedRowId: uuid.optional(),
    values: z.record(z.string().trim().min(1).max(200), z.unknown()).refine(
      (value) =>
        Object.keys(value).length > 0 && Object.keys(value).length <= 100,
      "values must contain between 1 and 100 fields.",
    ),
  }).strict().refine(
    (value) => (value.rowId === undefined) !== (value.rowIndex === undefined),
    "Exactly one of rowId or rowIndex is required.",
  );
  server.registerTool("update_table_row", {
    description:
      "Update one row selected by stable ID or exact 1-based row index atomically.",
    inputSchema: updateRowSchema,
    annotations: writeAnnotations,
  }, async (input: z.infer<typeof updateRowSchema>) =>
    executeRpc(
      context,
      "mcp_update_table_row",
      {
        p_project_id: context.projectId,
        p_table_id: input.tableId,
        p_row_id: input.rowId ?? null,
        p_row_index: input.rowIndex ?? null,
        p_expected_row_id: input.expectedRowId ?? null,
        p_values: input.values,
      },
      input,
      "Table row updated.",
      (data) => {
        const rowId = firstRow(data)?.row_id;
        if (typeof rowId === "string") {
          scheduleMcpReindex({
            kind: "row",
            projectId: context.projectId,
            actorUserId: context.userId,
            rowId,
          });
        }
      },
    ));

  const createDocumentSchema = z.object({
    name: z.string().trim().min(1).max(200),
    folderId: uuid.nullable().optional(),
    markdown: z.string(),
    allowDuplicate: z.boolean().optional(),
  }).strict();
  server.registerTool("create_document", {
    description: "Create one collaborative project document atomically.",
    inputSchema: createDocumentSchema,
    annotations: writeAnnotations,
  }, async (input: z.infer<typeof createDocumentSchema>) => {
    try {
      assertDocumentMarkdownSize(input.markdown);
      const normalized = await encodeDocumentMarkdown(input.markdown);
      const data = await rpc<unknown>(context, "mcp_create_document", {
        p_project_id: context.projectId,
        p_document_id: crypto.randomUUID(),
        p_folder_id: input.folderId ?? null,
        p_name: input.name,
        p_markdown: normalized.markdown,
        p_yjs_state: normalized.yjsStateBase64,
        p_allow_duplicate: input.allowDuplicate ?? false,
      });
      const documentId = firstRow(data)?.document_id;
      if (typeof documentId === "string") {
        scheduleMcpReindex({
          kind: "document",
          projectId: context.projectId,
          actorUserId: context.userId,
          documentId,
        });
      }
      return toolSuccess("Document created.", { ok: true, data });
    } catch (error) {
      return toolFailure(error);
    }
  });

  const updateDocumentSchema = z.object({
    documentId: uuid,
    markdown: z.string(),
    stateToken: z.object({
      epoch: z.number().int().min(0),
      revision: z.number().int().min(0),
      updateIds: z.array(uuid).max(10000),
    }).strict(),
  }).strict();
  server.registerTool("update_document", {
    description:
      "Replace document Markdown with complete state-token conflict protection.",
    inputSchema: updateDocumentSchema,
    annotations: writeAnnotations,
  }, async (input: z.infer<typeof updateDocumentSchema>) => {
    try {
      assertDocumentMarkdownSize(input.markdown);
      const data = await (async () => {
        const current = await readDocumentTransportState(
          context,
          input.documentId,
        );
        const token = input.stateToken;
        const currentIds = current.tail.map((row) => row.id);
        if (
          current.head.collab_epoch !== token.epoch ||
          current.head.collab_revision !== token.revision ||
          currentIds.length !== token.updateIds.length ||
          currentIds.some((id, index) => id !== token.updateIds[index])
        ) {
          throw new McpDomainError(
            "DOCUMENT_CONFLICT",
            "Document changed; read it again before updating.",
          );
        }
        if (current.head.yjs_state === null) {
          throw new McpDomainError(
            "DOCUMENT_CONFLICT",
            "Document collaboration state must be initialized before updating.",
          );
        }
        const [merged, replacement] = await Promise.all([
          normalizeDocumentState(
            current.head.yjs_state,
            current.tail.map((row) => row.update_data),
          ),
          encodeDocumentMarkdown(input.markdown),
        ]);
        const url = Deno.env.get("SUPABASE_URL");
        const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
        if (!url || !key) {
          throw new Error("Document replacement is unavailable.");
        }
        const privileged = createClient(url, key, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const result = await measureMcpPhase(
          context,
          "database",
          async () =>
            await privileged.rpc("mcp_replace_document_content", {
              p_project_id: context.projectId,
              p_document_id: input.documentId,
              p_actor_user_id: context.userId,
              p_backup_version_id: crypto.randomUUID(),
              p_expected_epoch: token.epoch,
              p_expected_revision: token.revision,
              p_expected_update_ids: token.updateIds,
              p_current_yjs_state: merged.yjsStateBase64,
              p_current_markdown: merged.markdown,
              p_replacement_yjs_state: replacement.yjsStateBase64,
              p_replacement_markdown: replacement.markdown,
            }),
        );
        if (result.error) {
          if (result.error.code === "PT409") {
            throw new McpDomainError(
              "DOCUMENT_CONFLICT",
              "Document changed; read it again before updating.",
            );
          }
          if (result.error.code === "42501") {
            throw new McpDomainError(
              "WRITE_FORBIDDEN",
              "The project is no longer writable.",
            );
          }
          throw new Error("Document replacement failed.");
        }
        return result.data;
      })();
      scheduleMcpReindex({
        kind: "document",
        projectId: context.projectId,
        actorUserId: context.userId,
        documentId: input.documentId,
      });
      return toolSuccess("Document updated.", { ok: true, data });
    } catch (error) {
      return toolFailure(error);
    }
  });
}
