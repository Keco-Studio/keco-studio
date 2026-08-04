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
const IMAGE_BUCKET = "library-media-files";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_EXTENSIONS = {
  "image/png": ["png"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/gif": ["gif"],
  "image/webp": ["webp"],
  "image/svg+xml": ["svg"],
} as const;
const imageFileType = z.enum([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
]);
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
    "image",
  ]),
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

type ProjectContextResolver = (
  projectId: string,
) => Promise<ProjectMcpRequestContext>;

async function withProjectContext<T>(
  input: Record<string, unknown>,
  contextFor: ProjectContextResolver,
  operation: (context: ProjectMcpRequestContext) => Promise<T>,
): Promise<T | ReturnType<typeof toolFailure>> {
  try {
    return await operation(await contextFor(input.projectId as string));
  } catch (error) {
    return toolFailure(error);
  }
}

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

function imageExtension(fileName: string): string {
  const separator = fileName.lastIndexOf(".");
  return separator < 0 ? "" : fileName.slice(separator + 1).toLowerCase();
}

function imageTypeMatchesName(
  fileName: string,
  fileType: keyof typeof IMAGE_EXTENSIONS,
): boolean {
  return (IMAGE_EXTENSIONS[fileType] as readonly string[]).includes(
    imageExtension(fileName),
  );
}

function sanitizeImageFileName(fileName: string): string {
  const extension = imageExtension(fileName);
  const safe = fileName
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^\.+/, "");
  const separator = safe.lastIndexOf(".");
  const stem = separator < 0 ? "" : safe.slice(0, separator);
  return stem && /[A-Za-z0-9]/.test(stem) ? safe : "image." + extension;
}

function uploadedImageFileName(path: string): string | null {
  const leaf = path.slice(path.lastIndexOf("/") + 1);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}-(.+)$/i
    .exec(leaf)?.[1] ?? null;
}

function imageSignatureMatches(
  fileType: keyof typeof IMAGE_EXTENSIONS,
  bytes: Uint8Array,
): boolean {
  const startsWith = (signature: readonly number[], offset = 0) =>
    signature.every((byte, index) => bytes[offset + index] === byte);
  if (fileType === "image/png") {
    return startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  }
  if (fileType === "image/jpeg") {
    return startsWith([0xff, 0xd8, 0xff]);
  }
  if (fileType === "image/gif") {
    return startsWith([0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) ||
      startsWith([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
  }
  if (fileType === "image/svg+xml") {
    const text = new TextDecoder().decode(bytes.slice(0, 4096)).trimStart();
    return /^(?:<\?xml[\s\S]*?\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg(?:\s|>)/.test(
      text,
    );
  }
  return startsWith([0x52, 0x49, 0x46, 0x46]) &&
    startsWith([0x57, 0x45, 0x42, 0x50], 8);
}

function svgContentIsSafe(bytes: Uint8Array): boolean {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).trimStart();
  } catch {
    return false;
  }
  if (
    !/^(?:<\?xml[\s\S]*?\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg(?:\s|>)/i.test(
      text,
    ) || !/<\/svg\s*>\s*$/i.test(text)
  ) {
    return false;
  }
  return !(
    /<!doctype\b|<!entity\b|<\?xml-stylesheet\b/i.test(text) ||
    /<(?:script|foreignobject|iframe|object|embed|use)\b/i.test(text) ||
    /<style\b|\bstyle\s*=/i.test(text) ||
    /(?:^|\s)on[a-z][\w:-]*\s*=/i.test(text) ||
    /(?:\b(?:href|xlink:href|src)\s*=|url\s*\(|@import\b)/i.test(text)
  );
}

async function removeInvalidImage(
  context: ProjectMcpRequestContext,
  path: string,
): Promise<void> {
  try {
    await measureMcpPhase(
      context,
      "database",
      async () =>
        await context.supabase.storage.from(IMAGE_BUCKET).remove([path]),
    );
  } catch {
    // Completion still returns the validation failure if best-effort cleanup fails.
  }
}

function registerWriteToolSet(
  server: McpServer,
  legacyContext: ProjectMcpRequestContext | null,
  resolveProject: ProjectContextResolver | null,
): void {
  if (legacyContext?.role === "viewer") return;
  const projectShape = resolveProject ? { projectId: uuid } : {};
  const contextFor: ProjectContextResolver = resolveProject ??
    (() => Promise.resolve(legacyContext as ProjectMcpRequestContext));

  const createTableSchema = z.object({
    ...projectShape,
    name: z.string().trim().min(1).max(200),
    description: z.string().max(2000).nullable().optional(),
    folderId: uuid.nullable().optional(),
    fields: z.array(fieldSchema).min(1).max(100),
  }).strict();
  server.registerTool(
    "create_table",
    {
      description:
        "Create one project table, its fields, and initial empty row atomically.",
      inputSchema: createTableSchema,
      annotations: writeAnnotations,
    },
    async (input: z.infer<typeof createTableSchema>) =>
      withProjectContext(input, contextFor, async (context) => {
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
      }),
  );

  const addTableFieldSchema = z.object({
    ...projectShape,
    tableId: uuid,
    field: fieldSchema.refine(
      (field) => field.required !== true,
      "Fields added to existing tables cannot be required.",
    ),
  }).strict();
  server.registerTool(
    "add_table_field",
    {
      description: "Append one optional field to an existing project table.",
      inputSchema: addTableFieldSchema,
      annotations: writeAnnotations,
    },
    async (input: z.infer<typeof addTableFieldSchema>) =>
      withProjectContext(input, contextFor, async (context) => {
        const fieldId = crypto.randomUUID();
        return await executeRpc(
          context,
          "mcp_add_table_field",
          {
            p_project_id: context.projectId,
            p_table_id: input.tableId,
            p_field_id: fieldId,
            p_field: input.field,
          },
          input,
          "Table field added.",
          () =>
            scheduleMcpReindex({
              kind: "table",
              projectId: context.projectId,
              actorUserId: context.userId,
              tableId: input.tableId,
            }),
        );
      }),
  );

  const createRowSchema = z.object({
    ...projectShape,
    tableId: uuid,
    values: z.record(z.string().trim().min(1).max(200), z.unknown()).refine(
      (value) =>
        Object.keys(value).length > 0 && Object.keys(value).length <= 100,
      "values must contain between 1 and 100 fields.",
    ),
    reuseEmpty: z.boolean().optional(),
  }).strict();
  server.registerTool(
    "create_table_row",
    {
      description: "Create or reuse one project table row atomically.",
      inputSchema: createRowSchema,
      annotations: writeAnnotations,
    },
    async (input: z.infer<typeof createRowSchema>) =>
      withProjectContext(input, contextFor, async (context) =>
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
        )),
  );

  const updateRowSchema = z.object({
    ...projectShape,
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
  server.registerTool(
    "update_table_row",
    {
      description:
        "Update one row selected by stable ID or exact 1-based row index atomically.",
      inputSchema: updateRowSchema,
      annotations: writeAnnotations,
    },
    async (input: z.infer<typeof updateRowSchema>) =>
      withProjectContext(input, contextFor, async (context) =>
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
        )),
  );

  const createDocumentSchema = z.object({
    ...projectShape,
    name: z.string().trim().min(1).max(200),
    folderId: uuid.nullable().optional(),
    markdown: z.string(),
    allowDuplicate: z.boolean().optional(),
  }).strict();
  server.registerTool(
    "create_document",
    {
      description: "Create one collaborative project document atomically.",
      inputSchema: createDocumentSchema,
      annotations: writeAnnotations,
    },
    async (input: z.infer<typeof createDocumentSchema>) =>
      withProjectContext(input, contextFor, async (context) => {
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
      }),
  );

  const updateDocumentSchema = z.object({
    ...projectShape,
    documentId: uuid,
    markdown: z.string(),
    stateToken: z.object({
      epoch: z.number().int().min(0),
      revision: z.number().int().min(0),
      updateIds: z.array(uuid).max(10000),
    }).strict(),
  }).strict();
  server.registerTool(
    "update_document",
    {
      description:
        "Replace document Markdown with complete state-token conflict protection.",
      inputSchema: updateDocumentSchema,
      annotations: writeAnnotations,
    },
    async (input: z.infer<typeof updateDocumentSchema>) =>
      withProjectContext(input, contextFor, async (context) => {
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
      }),
  );

  const createImageUploadSchema = z.object({
    ...projectShape,
    fileName: z.string().trim().min(1).max(200).refine(
      (value) => !/[\\/\u0000-\u001f]/.test(value),
      "fileName must be a plain file name.",
    ),
    fileType: imageFileType,
    fileSize: z.number().int().min(1).max(MAX_IMAGE_BYTES),
  }).strict().refine(
    (value) => imageTypeMatchesName(value.fileName, value.fileType),
    "fileName extension must match fileType.",
  );
  server.registerTool(
    "create_image_upload",
    {
      description:
        "Create a signed PUT target for one image up to 5 MiB. Call complete_image_upload after sending the bytes.",
      inputSchema: createImageUploadSchema,
      annotations: writeAnnotations,
    },
    async (input: z.infer<typeof createImageUploadSchema>) =>
      withProjectContext(input, contextFor, async (context) => {
        try {
          const fileName = sanitizeImageFileName(input.fileName);
          const path =
            `${context.userId}/${context.projectId}/${crypto.randomUUID()}-${fileName}`;
          const bucket = context.supabase.storage.from(IMAGE_BUCKET);
          const { data, error } = await measureMcpPhase(
            context,
            "database",
            async () =>
              await bucket.createSignedUploadUrl(path, { upsert: false }),
          );
          if (error || !data?.signedUrl) {
            throw new Error("Image upload target creation failed.");
          }
          const publicUrl = bucket.getPublicUrl(path).data.publicUrl;
          if (!publicUrl) throw new Error("Image public URL creation failed.");
          return toolSuccess("Image upload prepared.", {
            ok: true,
            upload: {
              url: data.signedUrl,
              method: "PUT",
              headers: {
                "cache-control": "max-age=3600",
                "content-type": input.fileType,
                "x-upsert": "false",
              },
              expiresInSeconds: 7200,
            },
            image: {
              url: publicUrl,
              path,
              fileName,
              fileSize: input.fileSize,
              fileType: input.fileType,
            },
          });
        } catch (error) {
          return toolFailure(error);
        }
      }),
  );

  const completeImageUploadSchema = z.object({
    ...projectShape,
    path: z.string().min(1).max(500),
  }).strict();
  server.registerTool(
    "complete_image_upload",
    {
      description:
        "Verify a prepared image upload and return metadata ready for an image table field.",
      inputSchema: completeImageUploadSchema,
      annotations: writeAnnotations,
    },
    async (input: z.infer<typeof completeImageUploadSchema>) =>
      withProjectContext(input, contextFor, async (context) => {
        const expectedPrefix = `${context.userId}/${context.projectId}/`;
        const fileName = uploadedImageFileName(input.path);
        const relativePath = input.path.startsWith(expectedPrefix)
          ? input.path.slice(expectedPrefix.length)
          : "";
        if (!fileName || !relativePath || relativePath.includes("/")) {
          return toolFailure(
            new McpDomainError(
              "FIELD_VALIDATION_FAILED",
              "The image path does not belong to this project upload.",
            ),
          );
        }
        try {
          const bucket = context.supabase.storage.from(IMAGE_BUCKET);
          const { data, error } = await measureMcpPhase(
            context,
            "database",
            async () => await bucket.info(input.path),
          );
          if (error || !data) {
            throw new McpDomainError(
              "FIELD_VALIDATION_FAILED",
              "The uploaded image could not be found.",
            );
          }
          const info = data as unknown as Record<string, unknown>;
          const metadata = info.metadata && typeof info.metadata === "object"
            ? info.metadata as Record<string, unknown>
            : {};
          const fileSize = Number(info.size ?? metadata.size);
          const rawFileType = String(
            info.contentType ?? metadata.mimetype ?? "",
          ).split(";", 1)[0].trim().toLowerCase();
          if (!Number.isInteger(fileSize) || fileSize < 1) {
            await removeInvalidImage(context, input.path);
            throw new McpDomainError(
              "FIELD_VALIDATION_FAILED",
              "The uploaded image is empty or has invalid size metadata.",
            );
          }
          if (fileSize > MAX_IMAGE_BYTES) {
            await removeInvalidImage(context, input.path);
            throw new McpDomainError(
              "PAYLOAD_TOO_LARGE",
              "The uploaded image must be at most 5 MiB.",
            );
          }
          if (
            !(rawFileType in IMAGE_EXTENSIONS) ||
            !imageTypeMatchesName(
              fileName,
              rawFileType as keyof typeof IMAGE_EXTENSIONS,
            )
          ) {
            await removeInvalidImage(context, input.path);
            throw new McpDomainError(
              "FIELD_VALIDATION_FAILED",
              "The uploaded object is not a supported raster image.",
            );
          }
          const { data: imageBlob, error: downloadError } =
            await measureMcpPhase(
              context,
              "database",
              async () => await bucket.download(input.path),
            );
          if (downloadError || !imageBlob) {
            throw new Error("Image verification download failed.");
          }
          const imageBytes = new Uint8Array(await imageBlob.arrayBuffer());
          if (
            imageBytes.byteLength !== fileSize ||
            !imageSignatureMatches(
              rawFileType as keyof typeof IMAGE_EXTENSIONS,
              imageBytes,
            ) ||
            (rawFileType === "image/svg+xml" && !svgContentIsSafe(imageBytes))
          ) {
            await removeInvalidImage(context, input.path);
            throw new McpDomainError(
              "FIELD_VALIDATION_FAILED",
              "The uploaded object content does not match its image type.",
            );
          }
          const uploadedAt = typeof info.createdAt === "string" &&
              Number.isFinite(Date.parse(info.createdAt))
            ? info.createdAt
            : new Date().toISOString();
          const publicUrl = bucket.getPublicUrl(input.path).data.publicUrl;
          if (!publicUrl) throw new Error("Image public URL creation failed.");
          return toolSuccess("Image upload completed.", {
            ok: true,
            image: {
              url: publicUrl,
              path: input.path,
              fileName,
              fileSize,
              fileType: rawFileType,
              uploadedAt,
            },
          });
        } catch (error) {
          return toolFailure(error);
        }
      }),
  );
}

export function registerWriteTools(
  server: McpServer,
  context: ProjectMcpRequestContext,
): void {
  registerWriteToolSet(server, context, null);
}

export function registerAccountWriteTools(
  server: McpServer,
  resolveProject: ProjectContextResolver,
): void {
  registerWriteToolSet(server, null, resolveProject);
}
