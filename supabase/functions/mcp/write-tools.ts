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
import { asPublicMcpError, McpDomainError } from "./errors.ts";
import { MAX_DOCUMENT_MARKDOWN_BYTES, utf8ByteLength } from "./limits.ts";
import { scheduleMcpReindex } from "./reindex.ts";
import { measureMcpPhase } from "./telemetry.ts";

const uuid = z.string().uuid();
const IMAGE_BUCKET = "library-media-files";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_PATH_CHARS = 2048;
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
const imageFileShape = {
  fileName: z.string().trim().min(1).max(200).refine(
    (value) => !/[\\/\u0000-\u001f]/.test(value),
    "fileName must be a plain file name.",
  ).describe("A plain local file name, without a directory path."),
  fileType: imageFileType.describe(
    "The supported media type matching fileName.",
  ),
  fileSize: z.number().int().min(1).max(MAX_IMAGE_BYTES).describe(
    "The local file size in bytes; raw bytes and Base64 are not accepted.",
  ),
};
const imageFileSchema = z.object(imageFileShape).strict().refine(
  (value) => imageTypeMatchesName(value.fileName, value.fileType),
  "fileName extension must match fileType.",
);
const writeAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};
const destructiveWriteAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
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

const rowSelectorSchema = {
  rowId: uuid.optional(),
  rowIndex: z.number().int().min(1).optional(),
  expectedRowId: uuid.optional(),
};
const exactlyOneRowSelector = (
  value: { rowId?: string; rowIndex?: number },
): boolean => (value.rowId === undefined) !== (value.rowIndex === undefined);
const ROW_SELECTOR_MESSAGE = "Exactly one of rowId or rowIndex is required.";

const rowValuesSchema = z.record(
  z.string().trim().min(1).max(200),
  z.unknown(),
).refine(
  (value) => Object.keys(value).length > 0 && Object.keys(value).length <= 100,
  "values must contain between 1 and 100 fields.",
);

const reorderFieldSchema = z.object({
  fieldId: uuid,
  section: z.string().trim().min(1).max(100),
  sectionId: z.string().trim().min(1).max(200).optional(),
}).strict();

const bulkRowUpdateSchema = z.object({
  ...rowSelectorSchema,
  values: rowValuesSchema,
}).strict().refine(exactlyOneRowSelector, ROW_SELECTOR_MESSAGE);

const upsertRowSchema = z.object({
  values: rowValuesSchema,
}).strict();

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

function rowIdsFromResult(value: unknown): string[] {
  const rowIds = firstRow(value)?.row_ids;
  return Array.isArray(rowIds)
    ? rowIds.filter((rowId): rowId is string => typeof rowId === "string")
    : [];
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

function imagePathFileName(fileName: string): string {
  // ASCII paths remain backward compatible. The marker is unambiguous because
  // sanitizeImageFileName replaces a literal tilde in an ASCII source name.
  return /^[\x20-\x7e]+$/.test(fileName)
    ? sanitizeImageFileName(fileName)
    : `~h${Array.from(new TextEncoder().encode(fileName), (byte) =>
      byte.toString(16).padStart(2, "0")).join("")}`;
}

function uploadedImageFileName(path: string): string | null {
  const leaf = path.slice(path.lastIndexOf("/") + 1);
  const stored = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}-(.+)$/i
    .exec(leaf)?.[1];
  if (!stored) return null;
  if (!stored.startsWith("~")) return stored;
  if (stored.startsWith("~h")) {
    const hex = stored.slice(2);
    if (!/^(?:[0-9a-f]{2})+$/i.test(hex)) return null;
    try {
      return new TextDecoder().decode(
        Uint8Array.from(hex.match(/../g)!, (pair) => parseInt(pair, 16)),
      );
    } catch {
      return null;
    }
  }
  try {
    // Accept paths created before the hex marker was introduced.
    return decodeURIComponent(stored.slice(1));
  } catch {
    return null;
  }
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

type ImageFileInput = z.infer<typeof imageFileSchema>;
type UploadDescriptor = {
  url: string;
  method: "PUT";
  headers: Record<string, string>;
  expiresInSeconds: number;
};
type ProvisionalImage = ImageFileInput & { url: string; path: string };
type VerifiedImage = ProvisionalImage & { uploadedAt: string };

async function prepareImageUpload(
  context: ProjectMcpRequestContext,
  input: ImageFileInput,
): Promise<{ upload: UploadDescriptor; image: ProvisionalImage }> {
  const fileName = input.fileName;
  const pathFileName = imagePathFileName(fileName);
  const path =
    `${context.userId}/${context.projectId}/${crypto.randomUUID()}-${pathFileName}`;
  const bucket = context.supabase.storage.from(IMAGE_BUCKET);
  const { data, error } = await measureMcpPhase(
    context,
    "database",
    async () => await bucket.createSignedUploadUrl(path, { upsert: false }),
  );
  if (error || !data?.signedUrl) {
    throw new McpDomainError(
      "IMAGE_UPLOAD_PREPARATION_FAILED",
      "The image upload target could not be prepared; retry preparation for this file.",
    );
  }
  const publicUrl = bucket.getPublicUrl(path).data.publicUrl;
  if (!publicUrl) {
    throw new McpDomainError(
      "IMAGE_UPLOAD_PREPARATION_FAILED",
      "The image upload target could not be prepared; retry preparation for this file.",
    );
  }
  return {
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
  };
}

async function completeImageUpload(
  context: ProjectMcpRequestContext,
  path: string,
): Promise<VerifiedImage> {
  const expectedPrefix = `${context.userId}/${context.projectId}/`;
  const fileName = uploadedImageFileName(path);
  const relativePath = path.startsWith(expectedPrefix)
    ? path.slice(expectedPrefix.length)
    : "";
  if (!fileName || !relativePath || relativePath.includes("/")) {
    throw new McpDomainError(
      "FIELD_VALIDATION_FAILED",
      "path must be the image.path returned by create_image_upload or prepare_image_uploads for this user and project; local paths, file: URIs, public URLs, and signed upload URLs are invalid.",
    );
  }

  const bucket = context.supabase.storage.from(IMAGE_BUCKET);
  const { data, error } = await measureMcpPhase(
    context,
    "database",
    async () => await bucket.info(path),
  );
  if (error || !data) {
    throw new McpDomainError(
      "IMAGE_UPLOAD_NOT_FOUND",
      "The uploaded image was not found. The object was not removed; PUT it before retrying completion, or prepare and PUT a new target if the prior target expired.",
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
    await removeInvalidImage(context, path);
    throw new McpDomainError(
      "FIELD_VALIDATION_FAILED",
      "The uploaded image had invalid size metadata and was removed; prepare and PUT it again.",
    );
  }
  if (fileSize > MAX_IMAGE_BYTES) {
    await removeInvalidImage(context, path);
    throw new McpDomainError(
      "PAYLOAD_TOO_LARGE",
      "The uploaded image exceeded 5 MiB and was removed; prepare and PUT it again.",
    );
  }
  if (
    !(rawFileType in IMAGE_EXTENSIONS) ||
    !imageTypeMatchesName(
      fileName,
      rawFileType as keyof typeof IMAGE_EXTENSIONS,
    )
  ) {
    await removeInvalidImage(context, path);
    throw new McpDomainError(
      "FIELD_VALIDATION_FAILED",
      "The uploaded object was not a supported image matching its extension and was removed; prepare and PUT it again.",
    );
  }
  const { data: imageBlob, error: downloadError } = await measureMcpPhase(
    context,
    "database",
    async () => await bucket.download(path),
  );
  if (downloadError || !imageBlob) {
    throw new McpDomainError(
      "INTERNAL_ERROR",
      "The uploaded image could not be verified. The object was not removed; retry completion only if the prior result is unknown or failed.",
    );
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
    await removeInvalidImage(context, path);
    throw new McpDomainError(
      "FIELD_VALIDATION_FAILED",
      "The uploaded object content failed image validation and was removed; prepare and PUT it again.",
    );
  }
  const uploadedAt = typeof info.createdAt === "string" &&
      Number.isFinite(Date.parse(info.createdAt))
    ? info.createdAt
    : new Date().toISOString();
  const publicUrl = bucket.getPublicUrl(path).data.publicUrl;
  if (!publicUrl) {
    throw new McpDomainError(
      "INTERNAL_ERROR",
      "The verified image metadata could not be constructed. The object was not removed; retry completion only if the prior result is unknown or failed.",
    );
  }
  return {
    url: publicUrl,
    path,
    fileName,
    fileSize,
    fileType: rawFileType as ImageFileInput["fileType"],
    uploadedAt,
  };
}

async function createFolder(
  context: ProjectMcpRequestContext,
  input: {
    name: string;
    description?: string | null;
    parentFolderId?: string | null;
  },
): Promise<Record<string, unknown>> {
  const { data, error } = await measureMcpPhase(
    context,
    "database",
    async () =>
      await context.supabase.rpc("mcp_create_folder", {
        p_project_id: context.projectId,
        p_name: input.name,
        p_description: input.description ?? null,
        p_parent_folder_id: input.parentFolderId ?? null,
      }),
  );
  if (error) {
    if (error.code === "KF401" || error.code === "42501") {
      throw new McpDomainError(
        "PROJECT_WRITE_FORBIDDEN",
        "Only the project owner or an accepted admin collaborator may create folders.",
      );
    }
    if (error.code === "KF404") {
      throw new McpDomainError(
        "FOLDER_NOT_FOUND",
        "The parent folder was not found in this project.",
      );
    }
    if (error.code === "KF409" || error.code === "23505") {
      throw new McpDomainError(
        "FOLDER_NAME_CONFLICT",
        "A folder with this name already exists in the selected parent scope.",
      );
    }
    if (
      error.code === "22023" || error.code === "23503" ||
      error.code === "23514"
    ) {
      throw new McpDomainError(
        "FIELD_VALIDATION_FAILED",
        "The folder input or nesting is invalid.",
      );
    }
    throw new McpDomainError(
      "INTERNAL_ERROR",
      "The folder could not be created.",
    );
  }
  const row = firstRow(data);
  if (!row) {
    throw new McpDomainError(
      "INTERNAL_ERROR",
      "The folder could not be created.",
    );
  }
  return row;
}

function registerCreateFolderTool(
  server: McpServer,
  projectShape: { projectId: typeof uuid } | Record<never, never>,
  contextFor: ProjectContextResolver,
): void {
  const schema = z.object({
    ...projectShape,
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().max(1000).nullable().optional(),
    parentFolderId: uuid.nullable().optional(),
  }).strict();
  server.registerTool(
    "create_folder",
    {
      description:
        "Create one root or nested project folder atomically. Only the project owner or an accepted admin collaborator may create folders. Editors and viewers receive PROJECT_WRITE_FORBIDDEN. After success, verify the returned folder with list_project_structure before using it as a write target.",
      inputSchema: schema,
      annotations: writeAnnotations,
    },
    async (input: z.infer<typeof schema>) =>
      withProjectContext(input, contextFor, async (context) => {
        if (context.role !== "admin") {
          return toolFailure(
            new McpDomainError(
              "PROJECT_WRITE_FORBIDDEN",
              "Only the project owner or an accepted admin collaborator may create folders.",
            ),
          );
        }
        try {
          const row = await createFolder(context, input);
          return toolSuccess("Folder created.", {
            ok: true,
            folder: {
              id: row.id,
              projectId: row.project_id,
              parentFolderId: row.parent_folder_id,
              name: row.name,
              description: row.description,
              createdAt: row.created_at,
              updatedAt: row.updated_at,
            },
          });
        } catch (error) {
          return toolFailure(error);
        }
      }),
  );
}

function registerWriteToolSet(
  server: McpServer,
  legacyContext: ProjectMcpRequestContext | null,
  resolveProject: ProjectContextResolver | null,
): void {
  const projectShape = resolveProject ? { projectId: uuid } : {};
  const contextFor: ProjectContextResolver = resolveProject ??
    (() => Promise.resolve(legacyContext as ProjectMcpRequestContext));
  if (legacyContext?.role === "viewer") return;

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
    ...rowSelectorSchema,
    values: rowValuesSchema,
  }).strict().refine(
    exactlyOneRowSelector,
    ROW_SELECTOR_MESSAGE,
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

  const editTableFieldSchema = z.object({
    ...projectShape,
    tableId: uuid,
    fieldId: uuid,
    field: fieldSchema,
    clearValuesOnTypeChange: z.boolean().optional(),
  }).strict();
  server.registerTool(
    "edit_table_field",
    {
      description:
        "Edit one table field. Type changes require clearValuesOnTypeChange when values exist; any edit resets the field formula.",
      inputSchema: editTableFieldSchema,
      annotations: writeAnnotations,
    },
    async (input: z.infer<typeof editTableFieldSchema>) =>
      withProjectContext(input, contextFor, async (context) =>
        executeRpc(
          context,
          "mcp_edit_table_field",
          {
            p_project_id: context.projectId,
            p_table_id: input.tableId,
            p_field_id: input.fieldId,
            p_field: input.field,
            p_clear_values_on_type_change: input.clearValuesOnTypeChange ??
              false,
          },
          input,
          "Table field edited.",
          () =>
            scheduleMcpReindex({
              kind: "table",
              projectId: context.projectId,
              actorUserId: context.userId,
              tableId: input.tableId,
            }),
        )),
  );

  const deleteTableFieldSchema = z.object({
    ...projectShape,
    tableId: uuid,
    fieldId: uuid,
    clearValues: z.boolean().optional(),
  }).strict();
  server.registerTool(
    "delete_table_field",
    {
      description:
        "Delete one table field. Non-empty fields require clearValues.",
      inputSchema: deleteTableFieldSchema,
      annotations: destructiveWriteAnnotations,
    },
    async (input: z.infer<typeof deleteTableFieldSchema>) =>
      withProjectContext(input, contextFor, async (context) =>
        executeRpc(
          context,
          "mcp_delete_table_field",
          {
            p_project_id: context.projectId,
            p_table_id: input.tableId,
            p_field_id: input.fieldId,
            p_clear_values: input.clearValues ?? false,
          },
          input,
          "Table field deleted.",
          () =>
            scheduleMcpReindex({
              kind: "table",
              projectId: context.projectId,
              actorUserId: context.userId,
              tableId: input.tableId,
            }),
        )),
  );

  const deleteTableRowSchema = z.object({
    ...projectShape,
    tableId: uuid,
    ...rowSelectorSchema,
    clearReferences: z.boolean().optional(),
  }).strict().refine(
    exactlyOneRowSelector,
    ROW_SELECTOR_MESSAGE,
  );
  server.registerTool(
    "delete_table_row",
    {
      description:
        "Delete one row selected by stable ID or exact 1-based row index. Referenced rows require clearReferences.",
      inputSchema: deleteTableRowSchema,
      annotations: destructiveWriteAnnotations,
    },
    async (input: z.infer<typeof deleteTableRowSchema>) =>
      withProjectContext(input, contextFor, async (context) =>
        executeRpc(
          context,
          "mcp_delete_table_row",
          {
            p_project_id: context.projectId,
            p_table_id: input.tableId,
            p_row_id: input.rowId ?? null,
            p_row_index: input.rowIndex ?? null,
            p_expected_row_id: input.expectedRowId ?? null,
            p_clear_references: input.clearReferences ?? false,
          },
          input,
          "Table row deleted.",
          () =>
            scheduleMcpReindex({
              kind: "table",
              projectId: context.projectId,
              actorUserId: context.userId,
              tableId: input.tableId,
            }),
        )),
  );

  const updateTableSchema = z.object({
    ...projectShape,
    tableId: uuid,
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(2000).nullable().optional(),
    folderId: uuid.nullable().optional(),
  }).strict().refine(
    (value) =>
      value.name !== undefined || value.description !== undefined ||
      value.folderId !== undefined,
    "At least one of name, description, or folderId is required.",
  );
  server.registerTool(
    "update_table",
    {
      description: "Update one table's name, description, or folder.",
      inputSchema: updateTableSchema,
      annotations: writeAnnotations,
    },
    async (input: z.infer<typeof updateTableSchema>) =>
      withProjectContext(input, contextFor, async (context) =>
        executeRpc(
          context,
          "mcp_update_table",
          {
            p_project_id: context.projectId,
            p_table_id: input.tableId,
            p_name: input.name ?? null,
            p_description: input.description ?? null,
            p_folder_id: input.folderId ?? null,
            p_set_folder: input.folderId !== undefined,
            p_set_description: input.description !== undefined,
          },
          input,
          "Table updated.",
          () =>
            scheduleMcpReindex({
              kind: "table",
              projectId: context.projectId,
              actorUserId: context.userId,
              tableId: input.tableId,
            }),
        )),
  );

  const reorderTableFieldsSchema = z.object({
    ...projectShape,
    tableId: uuid,
    fields: z.array(reorderFieldSchema).min(1).max(100),
  }).strict();
  server.registerTool(
    "reorder_table_fields",
    {
      description:
        "Atomically reorder every field in a table and optionally move fields between sections.",
      inputSchema: reorderTableFieldsSchema,
      annotations: writeAnnotations,
    },
    async (input: z.infer<typeof reorderTableFieldsSchema>) =>
      withProjectContext(input, contextFor, async (context) =>
        executeRpc(
          context,
          "mcp_reorder_table_fields",
          {
            p_project_id: context.projectId,
            p_table_id: input.tableId,
            p_fields: input.fields,
          },
          input,
          "Table fields reordered.",
          () =>
            scheduleMcpReindex({
              kind: "table",
              projectId: context.projectId,
              actorUserId: context.userId,
              tableId: input.tableId,
            }),
        )),
  );

  const deleteTableSchema = z.object({
    ...projectShape,
    tableId: uuid,
    confirmName: z.string().trim().min(1).max(200),
    clearReferences: z.boolean().optional(),
  }).strict();
  server.registerTool(
    "delete_table",
    {
      description:
        "Delete one table. confirmName must match the table name; referenced rows require clearReferences.",
      inputSchema: deleteTableSchema,
      annotations: destructiveWriteAnnotations,
    },
    async (input: z.infer<typeof deleteTableSchema>) =>
      withProjectContext(input, contextFor, async (context) =>
        executeRpc(
          context,
          "mcp_delete_table",
          {
            p_project_id: context.projectId,
            p_table_id: input.tableId,
            p_confirm_name: input.confirmName,
            p_clear_references: input.clearReferences ?? false,
          },
          input,
          "Table deleted.",
        )),
  );

  const bulkUpdateTableRowsSchema = z.object({
    ...projectShape,
    tableId: uuid,
    rows: z.array(bulkRowUpdateSchema).min(1).max(100),
  }).strict();
  server.registerTool(
    "bulk_update_table_rows",
    {
      description: "Atomically update 1 to 100 existing table rows.",
      inputSchema: bulkUpdateTableRowsSchema,
      annotations: writeAnnotations,
    },
    async (input: z.infer<typeof bulkUpdateTableRowsSchema>) =>
      withProjectContext(input, contextFor, async (context) =>
        executeRpc(
          context,
          "mcp_bulk_update_table_rows",
          {
            p_project_id: context.projectId,
            p_table_id: input.tableId,
            p_rows: input.rows,
          },
          input,
          "Table rows updated.",
          (data) => {
            for (const rowId of rowIdsFromResult(data)) {
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

  const upsertTableRowsSchema = z.object({
    ...projectShape,
    tableId: uuid,
    matchField: z.string().trim().min(1).max(200),
    rows: z.array(upsertRowSchema).min(1).max(100),
    reuseEmpty: z.boolean().optional(),
  }).strict();
  server.registerTool(
    "upsert_table_rows",
    {
      description:
        "Atomically create or update 1 to 100 rows using a stable match field.",
      inputSchema: upsertTableRowsSchema,
      annotations: writeAnnotations,
    },
    async (input: z.infer<typeof upsertTableRowsSchema>) =>
      withProjectContext(input, contextFor, async (context) =>
        executeRpc(
          context,
          "mcp_upsert_table_rows",
          {
            p_project_id: context.projectId,
            p_table_id: input.tableId,
            p_match_field: input.matchField,
            p_rows: input.rows,
            p_reuse_empty: input.reuseEmpty ?? false,
          },
          input,
          "Table rows upserted.",
          (data) => {
            for (const rowId of rowIdsFromResult(data)) {
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
    ...imageFileShape,
  }).strict().refine(
    (value) => imageTypeMatchesName(value.fileName, value.fileType),
    "fileName extension must match fileType.",
  );
  server.registerTool(
    "create_image_upload",
    {
      description:
        "Prepare one image upload from metadata only. Send the exact local file bytes to upload.url before expiry using upload.method and every upload.headers entry. Then pass only this response's image.path to complete_image_upload.path; never pass a local path, file: URI, public URL, or signed upload URL. Retrying preparation creates a new target.",
      inputSchema: createImageUploadSchema,
      annotations: writeAnnotations,
    },
    async (input: z.infer<typeof createImageUploadSchema>) =>
      withProjectContext(input, contextFor, async (context) => {
        try {
          const prepared = await prepareImageUpload(context, input);
          return toolSuccess("Image upload prepared.", {
            ok: true,
            ...prepared,
          });
        } catch (error) {
          return toolFailure(error);
        }
      }),
  );

  const completeImageUploadSchema = z.object({
    ...projectShape,
    path: z.string().trim().min(1).max(MAX_IMAGE_PATH_CHARS).describe(
      "Only image.path from create_image_upload or prepare_image_uploads for the same user and project; local paths, file: URIs, public URLs, and signed upload URLs are invalid.",
    ),
  }).strict();
  server.registerTool(
    "complete_image_upload",
    {
      description:
        "Verify one object after its exact bytes were PUT with the returned method and headers. path must be the preparation response's image.path. Use the complete verified image object returned here as the Keco image-field value; do not reduce it to a URL or path. Retry unchanged completion only when the prior result is unknown or failed without removing the object.",
      inputSchema: completeImageUploadSchema,
      annotations: writeAnnotations,
    },
    async (input: z.infer<typeof completeImageUploadSchema>) =>
      withProjectContext(input, contextFor, async (context) => {
        try {
          const image = await completeImageUpload(context, input.path);
          return toolSuccess("Image upload completed.", {
            ok: true,
            image,
          });
        } catch (error) {
          return toolFailure(error);
        }
      }),
  );

  const prepareImageUploadsSchema = z.object({
    ...projectShape,
    files: z.array(imageFileSchema).min(1).max(20),
  }).strict();
  server.registerTool(
    "prepare_image_uploads",
    {
      description:
        "Prepare 1-20 image uploads from metadata only, preserving order. For every successful item, PUT the exact local bytes to upload.url using upload.method and all upload.headers, then pass only item.image.path to complete_image_uploads. Runtime failures are item-scoped; failedCount signals partial failure. Retrying preparation creates new targets. Never persist or log signed URLs or headers.",
      inputSchema: prepareImageUploadsSchema,
      annotations: writeAnnotations,
    },
    async (input: z.infer<typeof prepareImageUploadsSchema>) =>
      withProjectContext(input, contextFor, async (context) => {
        const items = [];
        for (const [index, file] of input.files.entries()) {
          try {
            items.push({
              index,
              ok: true as const,
              file,
              ...await prepareImageUpload(context, file),
            });
          } catch (error) {
            const safe = asPublicMcpError(error);
            items.push({
              index,
              ok: false as const,
              file,
              error: { code: safe.code, message: safe.message },
            });
          }
        }
        const failedCount = items.filter((item) => !item.ok).length;
        return toolSuccess("Image upload targets prepared.", {
          ok: true,
          preparedCount: items.length - failedCount,
          failedCount,
          items,
        });
      }),
  );

  const completeImageUploadsSchema = z.object({
    ...projectShape,
    paths: z.array(z.string().trim().min(1).max(MAX_IMAGE_PATH_CHARS)).min(1)
      .max(20).refine(
      (paths) => new Set(paths).size === paths.length,
      "paths must be unique.",
    ),
  }).strict();
  server.registerTool(
    "complete_image_uploads",
    {
      description:
        "Verify 1-20 prepared image paths after successful PUTs, preserving order. Every path must be an image.path returned by a Keco preparation tool for this user and project, never a local path, file: URI, public URL, or signed URL. Runtime failures are item-scoped; failedCount signals partial failure. Use each complete verified image object as its Keco image-field value.",
      inputSchema: completeImageUploadsSchema,
      annotations: writeAnnotations,
    },
    async (input: z.infer<typeof completeImageUploadsSchema>) =>
      withProjectContext(input, contextFor, async (context) => {
        const items = [];
        for (const [index, path] of input.paths.entries()) {
          try {
            items.push({
              index,
              ok: true as const,
              path,
              image: await completeImageUpload(context, path),
            });
          } catch (error) {
            const safe = asPublicMcpError(error);
            items.push({
              index,
              ok: false as const,
              path,
              error: {
                code: safe.code === "PAYLOAD_TOO_LARGE"
                  ? "FIELD_VALIDATION_FAILED"
                  : safe.code,
                message: safe.message,
              },
            });
          }
        }
        const failedCount = items.filter((item) => !item.ok).length;
        return toolSuccess("Image uploads completed.", {
          ok: true,
          completedCount: items.length - failedCount,
          failedCount,
          items,
        });
      }),
  );

  registerCreateFolderTool(server, projectShape, contextFor);
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
