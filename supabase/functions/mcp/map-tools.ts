import type { McpServer } from "@mcp/server/mcp.js";
import { z } from "zod";
import { callKecoApp, type KecoAppRequest } from "./app-bridge.ts";
import type { McpRequestContext } from "./context.ts";
import { McpDomainError } from "./errors.ts";
import { toolFailure, toolSuccess } from "./results.ts";

type AppCaller = (
  context: McpRequestContext,
  request: KecoAppRequest,
) => Promise<unknown>;
type MapDependencies = { callApp?: AppCaller; includeWrites?: boolean };

const uuid = z.string().uuid();
const fingerprint = z.string().regex(/^[a-f0-9]{64}$/);
const projectShape = (context: McpRequestContext) =>
  context.mode === "account" ? { projectId: uuid } : {};
const boundedString = (max: number) => z.string().trim().min(1).max(max);

const referenceSchema = z.object({
  assetId: uuid,
  sha256: fingerprint,
  role: z.enum(["content", "layout"]),
  usage: boundedString(240),
}).strict();
const planSchema = z.object({
  schemaVersion: z.literal(3),
  name: boundedString(160),
  summary: boundedString(500),
  map: z.object({
    width: z.number().int().positive().max(688),
    height: z.number().int().positive().max(688),
  }).strict(),
  description: boundedString(2_000),
  references: z.array(referenceSchema).max(4),
  styleReference: z.object({
    assetId: uuid,
    sha256: fingerprint,
    copy: z.array(z.enum(["color_palette", "outline", "detail", "shading"]))
      .min(1).max(4),
  }).strict().nullable(),
  generation: z.object({
    provider: z.literal("pixellab"),
    operation: z.literal("create_image_pro"),
    noBackground: z.literal(false),
    seed: z.number().int().nonnegative().nullable(),
  }).strict(),
}).strict();
const collisionGridSchema = z.object({
  version: z.literal(1),
  cellSize: z.literal(8),
  columns: z.number().int().positive().max(86),
  rows: z.number().int().positive().max(86),
  cells: z.array(z.union([z.literal(0), z.literal(1)])).max(4_128),
  imageSha256: fingerprint,
}).strict().superRefine((grid, context) => {
  if (!["64x64", "86x48", "48x86"].includes(`${grid.columns}x${grid.rows}`)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["columns"],
      message: "Unsupported collision grid.",
    });
  }
  if (grid.cells.length !== grid.columns * grid.rows) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["cells"],
      message: "Collision cell count mismatch.",
    });
  }
});
const sceneSchema = z.object({
  schemaVersion: z.literal(3),
  size: z.object({
    width: z.number().int().positive().max(688),
    height: z.number().int().positive().max(688),
  }).strict(),
  mapImage: z.object({
    assetKey: z.literal("map-image"),
    sourceRevisionId: uuid,
    width: z.number().int().positive().max(688),
    height: z.number().int().positive().max(688),
    locked: z.literal(true),
  }).strict().nullable(),
  collisionGrid: collisionGridSchema.nullable(),
  canvas: z.object({
    zoom: z.number().positive().max(100),
    panX: z.number().finite(),
    panY: z.number().finite(),
  }).strict(),
}).strict();

const readAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
const writeAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function pick(
  value: unknown,
  fields: readonly string[],
): Record<string, unknown> {
  const source = record(value);
  const output: Record<string, unknown> = {};
  for (const field of fields) {
    if (source[field] !== undefined) output[field] = source[field];
  }
  return output;
}

const MAP_SUMMARY_FIELDS = [
  "id",
  "projectId",
  "projectName",
  "name",
  "currentRevisionId",
  "updatedAt",
  "schemaVersion",
] as const;
const GENERATION_FIELDS = [
  "assetId",
  "status",
  "generationId",
  "planFingerprint",
  "attemptCount",
  "lastErrorCode",
  "providerJobId",
  "storagePath",
  "sha256",
  "width",
  "height",
  "hasTransparency",
  "imageUrl",
] as const;
const PREPARE_FIELDS = [
  "mapId",
  "revisionId",
  "nextDraftRevisionId",
  "assetId",
  "status",
  "generationId",
  "planFingerprint",
  "feeNotice",
  "confirmationPurpose",
  "confirmationExpiresAt",
  "confirmationToken",
] as const;

function publicPayload(
  action: string,
  value: unknown,
): Record<string, unknown> {
  const source = record(value);
  if (action === "list_maps") {
    return {
      items: Array.isArray(source.items)
        ? source.items.slice(0, 200).map((item) =>
          pick(item, MAP_SUMMARY_FIELDS)
        )
        : [],
      returnedCount: typeof source.returnedCount === "number"
        ? source.returnedCount
        : 0,
    };
  }
  if (action === "read_map") {
    const output = pick(source, [
      "projectId",
      "identity",
      "plan",
      "scene",
      "sourceDocumentId",
      "schemaVersion",
    ]);
    if (source.generation !== undefined) {
      output.generation = source.generation === null
        ? null
        : pick(source.generation, GENERATION_FIELDS);
    }
    return output;
  }
  if (action === "create_map_draft") {
    return pick(source, [
      "mapId",
      "revisionId",
      "revisionNumber",
      "saveVersion",
      "projectId",
      "schemaVersion",
      "plan",
      "scene",
      "sourceDocumentId",
    ]);
  }
  if (action === "update_map_draft") {
    return pick(source, ["mapId", "revisionId", "saveVersion"]);
  }
  if (action === "prepare_map_generation") return pick(source, PREPARE_FIELDS);
  return pick(source, GENERATION_FIELDS);
}

function projectIdFor(
  context: McpRequestContext,
  input: { projectId?: unknown },
): string {
  if (context.mode === "project") return context.projectId;
  if (typeof input.projectId !== "string") {
    throw new McpDomainError(
      "FIELD_VALIDATION_FAILED",
      "A valid projectId is required.",
    );
  }
  return input.projectId;
}

function actionBody(
  context: McpRequestContext,
  action: string,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const { projectId: _projectId, ...rest } = input;
  return { action, projectId: projectIdFor(context, input), ...rest };
}

export function registerMapTools(
  server: McpServer,
  context: McpRequestContext,
  dependencies: MapDependencies = {},
): void {
  const callApp = dependencies.callApp ?? callKecoApp;
  const includeWrites = dependencies.includeWrites ??
    (context.mode === "account" || context.role !== "viewer");
  const register = <Schema extends z.ZodTypeAny>(
    name: string,
    description: string,
    inputSchema: Schema,
    annotations: typeof readAnnotations,
  ) => {
    server.registerTool(
      name,
      { description, inputSchema, annotations },
      async (input: z.infer<Schema>) => {
        try {
          const payload = await callApp(context, {
            method: "POST",
            path: "/api/mcp/create-map",
            body: actionBody(context, name, input as Record<string, unknown>),
          });
          return toolSuccess("Create Map operation completed.", {
            ok: true,
            ...publicPayload(name, payload),
          });
        } catch (error) {
          return toolFailure(error);
        }
      },
    );
  };

  const listSchema = z.object(projectShape(context)).strict();
  register(
    "list_maps",
    "List saved V3 maps in the selected project.",
    listSchema,
    readAnnotations,
  );

  const readSchema = z.object({ ...projectShape(context), mapId: uuid })
    .strict();
  register(
    "read_map",
    "Read one saved V3 map, Plan, Scene, and generation state.",
    readSchema,
    readAnnotations,
  );

  if (includeWrites) {
    const createSchema = z.object({
      ...projectShape(context),
      description: z.string().trim().max(4_000).default(""),
      documentId: uuid.nullable().default(null),
      referenceIds: z.array(uuid).max(4).default([]),
      styleReferenceId: uuid.nullable().default(null),
      referenceRoles: z.record(uuid, z.enum(["content", "layout"])).default({}),
      referenceUsage: z.record(uuid, boundedString(240)).default({}),
      styleCopy: z.array(
        z.enum(["color_palette", "outline", "detail", "shading"]),
      ).max(4).default([]),
      idempotencyKey: uuid,
    }).strict().refine(
      (value) => value.description.length > 0 || value.documentId !== null,
      { message: "A description or source document is required." },
    );
    register(
      "create_map_draft",
      "Create an idempotent V3 map draft from a bounded description or project document.",
      createSchema,
      { ...writeAnnotations, idempotentHint: true },
    );

    const updateSchema = z.object({
      ...projectShape(context),
      mapId: uuid,
      revisionId: uuid,
      saveVersion: z.number().int().nonnegative(),
      plan: planSchema,
      scene: sceneSchema,
    }).strict();
    register(
      "update_map_draft",
      "Update a V3 map draft using optimistic saveVersion concurrency.",
      updateSchema,
      { ...writeAnnotations, idempotentHint: true },
    );

    const prepareSchema = z.object({
      ...projectShape(context),
      mapId: uuid,
      revisionId: uuid,
      saveVersion: z.number().int().nonnegative(),
    }).strict();
    register(
      "prepare_map_generation",
      "Freeze the exact V3 revision and return a paid-generation fee notice plus a short-lived confirmation token without contacting the provider. Show the fee notice before asking for later explicit confirmation.",
      prepareSchema,
      { ...writeAnnotations, idempotentHint: true },
    );

    const generationShape = {
      ...projectShape(context),
      mapId: uuid,
      revisionId: uuid,
      assetId: uuid,
      generationId: uuid,
      planFingerprint: fingerprint,
    };
    const startSchema = z.object({
      ...generationShape,
      confirmationToken: z.string().min(1).max(4_096),
      confirmPaidGeneration: z.literal(true),
    }).strict();
    register(
      "start_map_generation",
      "Start the paid provider operation only after showing the prepare fee notice and receiving a later explicit confirmation. Requires the returned token and literal confirmPaidGeneration true.",
      startSchema,
      { ...writeAnnotations, idempotentHint: true, openWorldHint: true },
    );

    const getSchema = z.object(generationShape).strict();
    register(
      "get_map_generation",
      "Read persisted V3 map generation status and ready image URL without contacting the provider.",
      getSchema,
      { ...readAnnotations, openWorldHint: true },
    );

    register(
      "advance_map_generation",
      "Advance an existing provider job by resolving an old unknown queue state, polling, or validating. This never starts a new paid provider submission.",
      getSchema,
      { ...writeAnnotations, openWorldHint: true },
    );
  } else {
    const getSchema = z.object({
      ...projectShape(context),
      mapId: uuid,
      revisionId: uuid,
      assetId: uuid,
      generationId: uuid,
      planFingerprint: fingerprint,
    }).strict();
    register(
      "get_map_generation",
      "Read persisted V3 map generation status and ready image URL without contacting the provider.",
      getSchema,
      { ...readAnnotations, openWorldHint: true },
    );
  }
}
