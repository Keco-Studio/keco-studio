import type { McpServer } from "@mcp/server/mcp.js";
import { z } from "zod";
import { callKecoApp, type KecoAppRequest } from "./app-bridge.ts";
import type { McpRequestContext } from "./context.ts";
import { decodeCursor, encodeCursor } from "./cursor.ts";
import { McpDomainError } from "./errors.ts";
import { toolFailure, toolSuccess } from "./results.ts";

type AppCaller = (
  context: McpRequestContext,
  request: KecoAppRequest,
) => Promise<unknown>;

type GdsDependencies = { callApp?: AppCaller };

const uuid = z.string().uuid();
const idempotencyKey = z.string().trim().min(8).max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);
const versionIdempotencyKey = z.string().uuid();
const boundedString = (max: number) => z.string().trim().min(1).max(max);

const ruleSchema = z.object({
  id: z.string().trim().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/).max(80),
  kind: z.enum(["principle", "constraint", "pattern", "anti_pattern", "check"]),
  title: boundedString(120),
  statement: boundedString(800),
  rationale: z.string().trim().max(1200).optional(),
  appliesWhen: boundedString(500),
  severity: z.enum(["required", "recommended", "warning"]),
  evidence: z.string().trim().max(500).optional(),
}).strict();

const ruleSetSchema = z.object({
  schemaVersion: z.literal(1),
  genres: z.array(boundedString(80)).max(20),
  philosophies: z.array(boundedString(120)).max(20),
  suitableFor: boundedString(500),
  rules: z.array(ruleSchema).min(1).max(80),
  tableGuidance: z.array(
    z.object({
      table: boundedString(120),
      purpose: boundedString(500),
      fields: z.array(boundedString(120)).max(20),
    }).strict(),
  ).max(20),
}).strict();

const documentSchema = z.object({
  gameBackground: boundedString(4000).optional(),
  designIntent: boundedString(4000),
  playerFantasy: boundedString(4000),
  coreLoop: boundedString(4000),
  decisionStructure: boundedString(4000),
  systemBoundaries: boundedString(4000),
  progressionEconomy: boundedString(4000),
  contentModel: boundedString(4000),
  difficultyBalance: boundedString(4000),
  experiencePresentation: boundedString(4000),
}).strict();

const artStyleSchema = z.object({
  presetId: z.string().min(1).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  presetVersion: z.number().int().positive(),
  customization: z.object({
    direction: z.string().max(2000).optional(),
    referenceGames: z.array(
      z.object({
        name: z.string().max(120),
        borrow: z.string().max(500),
      }).strict(),
    ).max(8),
    avoid: z.string().max(1000).optional(),
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

const VERSION_FIELDS = [
  "id",
  "system_id",
  "version_number",
  "parent_version_id",
  "document",
  "rules",
  "artStyle",
  "artStyleReadError",
  "rendered_markdown",
  "source_snapshots",
  "diff",
  "conflicts",
  "content_hash",
  "created_at",
] as const;

function publicVersion(value: unknown): Record<string, unknown> {
  return pick(value, VERSION_FIELDS);
}

function publicSystem(value: unknown): Record<string, unknown> {
  const source = record(value);
  const output = pick(source, [
    "id",
    "source",
    "title",
    "summary",
    "genres",
    "philosophies",
    "suitable_for",
    "status",
    "current_version_id",
    "migration_status",
    "generation_job_id",
    "created_at",
    "updated_at",
  ]);
  if (source.current_version !== undefined) {
    output.current_version = source.current_version === null
      ? null
      : publicVersion(source.current_version);
  }
  if (Array.isArray(source.versions)) {
    output.versions = source.versions.slice(0, 50).map(publicVersion);
  }
  return output;
}

function publicJob(value: unknown): Record<string, unknown> {
  const source = record(value);
  const output = pick(source, [
    "id",
    "status",
    "phase",
    "design_system_id",
    "output_version_id",
    "attempt_count",
    "max_attempts",
    "available_at",
    "started_at",
    "completed_at",
    "created_at",
    "updated_at",
  ]);
  if (source.status === "failed") {
    output.error = {
      code: "GDS_GENERATION_FAILED",
      message: "Game Design System generation failed.",
    };
  }
  return output;
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

function projectShape(context: McpRequestContext) {
  return context.mode === "account" ? { projectId: uuid } : {};
}

function cursorSecret(): string {
  const secret = Deno.env.get("MCP_CURSOR_SECRET");
  if (!secret) throw new Error("MCP_CURSOR_SECRET is required.");
  return secret;
}

async function listPosition(
  context: McpRequestContext,
  input: { limit?: number; cursor?: string },
) {
  const limit = input.limit ?? 50;
  let offset = 0;
  const binding = {
    kind: "game_design_systems",
    scope: "account" as const,
    userId: context.userId,
  };
  if (input.cursor) {
    const position = await decodeCursor<{ offset?: unknown }>(
      input.cursor,
      binding,
      cursorSecret(),
    );
    if (
      !Number.isSafeInteger(position?.offset) || Number(position.offset) < 0
    ) {
      throw new McpDomainError(
        "INVALID_CURSOR",
        "The pagination cursor is invalid or expired.",
      );
    }
    offset = Number(position.offset);
  }
  return { limit, offset, binding };
}

export function registerGdsTools(
  server: McpServer,
  context: McpRequestContext,
  dependencies: GdsDependencies = {},
): void {
  const callApp = dependencies.callApp ?? callKecoApp;
  const listSchema = z.object({
    limit: z.number().int().min(1).max(100).optional(),
    cursor: z.string().min(1).max(4096).optional(),
  }).strict();
  server.registerTool("list_game_design_systems", {
    description:
      "List visible Game Design Systems with bounded signed pagination.",
    inputSchema: listSchema,
    annotations: readAnnotations,
  }, async (input: z.infer<typeof listSchema>) => {
    try {
      const position = await listPosition(context, input);
      const payload = record(
        await callApp(context, {
          method: "GET",
          path: `/api/game-design-systems?limit=${position.limit + 1}&offset=${position.offset}`,
        }),
      );
      const systems = Array.isArray(payload.systems)
        ? payload.systems.slice(0, position.limit).map(publicSystem)
        : [];
      const hasMore = payload.hasMore === true ||
        (Array.isArray(payload.systems) && payload.systems.length > position.limit);
      const nextOffset = position.offset + systems.length;
      const page = {
        systems,
        returnedCount: systems.length,
        hasMore,
        nextCursor: hasMore
          ? await encodeCursor(position.binding, { offset: nextOffset }, cursorSecret())
          : null,
      };
      return toolSuccess("Game Design Systems loaded.", { ok: true, ...page });
    } catch (error) {
      return toolFailure(error);
    }
  });

  const systemSchema = z.object({ systemId: uuid }).strict();
  server.registerTool("read_game_design_system", {
    description:
      "Read one visible Game Design System and bounded version history.",
    inputSchema: systemSchema,
    annotations: readAnnotations,
  }, async (input: z.infer<typeof systemSchema>) => {
    try {
      const payload = record(
        await callApp(context, {
          method: "GET",
          path: `/api/game-design-systems/${
            encodeURIComponent(input.systemId)
          }?versionLimit=50`,
        }),
      );
      return toolSuccess("Game Design System loaded.", {
        ok: true,
        system: publicSystem(payload.system),
      });
    } catch (error) {
      return toolFailure(error);
    }
  });

  const projectSchema = z.object(projectShape(context)).strict();
  server.registerTool("read_project_game_design_system", {
    description: "Read the Game Design System currently pinned to a project.",
    inputSchema: projectSchema,
    annotations: readAnnotations,
  }, async (input: z.infer<typeof projectSchema>) => {
    try {
      const projectId = projectIdFor(context, input);
      const payload = record(
        await callApp(context, {
          method: "GET",
          path: `/api/projects/${
            encodeURIComponent(projectId)
          }/game-design-system`,
        }),
      );
      return toolSuccess("Project Game Design System loaded.", {
        ok: true,
        system: payload.system === null ? null : publicSystem(payload.system),
      });
    } catch (error) {
      return toolFailure(error);
    }
  });

  const jobSchema = z.object({ generationJobId: uuid }).strict();
  server.registerTool("get_game_design_system_generation", {
    description: "Read the current status of an owned GDS generation job.",
    inputSchema: jobSchema,
    annotations: readAnnotations,
  }, async (input: z.infer<typeof jobSchema>) => {
    try {
      const payload = record(
        await callApp(context, {
          method: "GET",
          path: `/api/game-design-systems/generation-jobs/${
            encodeURIComponent(input.generationJobId)
          }`,
        }),
      );
      return toolSuccess("GDS generation status loaded.", {
        ok: true,
        job: publicJob(payload.job),
      });
    } catch (error) {
      return toolFailure(error);
    }
  });

  const createSchema = z.object({
    title: boundedString(120),
    summary: z.string().trim().max(1000).optional(),
    rules: ruleSetSchema,
  }).strict();
  server.registerTool("create_game_design_system", {
    description:
      "Create an owned Game Design System from a complete structured rule set.",
    inputSchema: createSchema,
    annotations: writeAnnotations,
  }, async (input: z.infer<typeof createSchema>) => {
    try {
      const payload = record(
        await callApp(context, {
          method: "POST",
          path: "/api/game-design-systems",
          body: input,
        }),
      );
      return toolSuccess("Game Design System created.", {
        ok: true,
        system: publicSystem(payload.system),
      });
    } catch (error) {
      return toolFailure(error);
    }
  });

  const generateSchema = z.object({
    title: boundedString(120),
    genres: z.array(boundedString(80)).max(20).default([]),
    philosophies: z.array(boundedString(120)).max(20).default([]),
    description: z.string().trim().max(4000).optional(),
    suitableFor: z.string().trim().max(500).optional(),
    baseSystemId: uuid.optional(),
    pastedMarkdown: z.string().max(20_000).optional(),
    references: z.array(
      z.object({
        kind: z.enum(["document", "table"]),
        projectId: uuid,
        resourceId: uuid,
      }).strict(),
    ).max(10).default([]),
    referenceGames: z.array(
      z.object({
        name: boundedString(120),
        reference: z.string().trim().max(500),
        avoid: z.string().trim().max(500),
      }).strict(),
    ).max(10).default([]),
    artStyle: artStyleSchema,
    idempotencyKey,
  }).strict();
  server.registerTool("generate_game_design_system", {
    description: "Start idempotent AI generation for a new Game Design System.",
    inputSchema: generateSchema,
    annotations: {
      ...writeAnnotations,
      idempotentHint: true,
      openWorldHint: true,
    },
  }, async (input: z.infer<typeof generateSchema>) => {
    try {
      const { idempotencyKey, ...body } = input;
      const payload = record(
        await callApp(context, {
          method: "POST",
          path: "/api/game-design-systems/generation-jobs",
          idempotencyKey,
          body,
        }),
      );
      return toolSuccess("GDS generation queued.", {
        ok: true,
        job: publicJob(payload.job),
      });
    } catch (error) {
      return toolFailure(error);
    }
  });

  const versionSchema = z.object({
    systemId: uuid,
    parentVersionId: uuid,
    expectedCurrentVersionId: uuid,
    document: documentSchema.optional(),
    rules: ruleSetSchema.optional(),
    artStyle: artStyleSchema.nullable().optional(),
    idempotencyKey: versionIdempotencyKey,
  }).strict().refine(
    (value) =>
      value.document !== undefined || value.rules !== undefined ||
      value.artStyle !== undefined,
    { message: "At least one version component must be supplied." },
  );
  server.registerTool("create_game_design_system_version", {
    description:
      "Create an idempotent version under an owned Game Design System.",
    inputSchema: versionSchema,
    annotations: { ...writeAnnotations, idempotentHint: true },
  }, async (input: z.infer<typeof versionSchema>) => {
    try {
      const { systemId, idempotencyKey, ...body } = input;
      const payload = record(
        await callApp(context, {
          method: "POST",
          path: `/api/game-design-systems/${
            encodeURIComponent(systemId)
          }/versions`,
          idempotencyKey,
          body,
        }),
      );
      return toolSuccess("Game Design System version created.", {
        ok: true,
        version: publicVersion(payload.version),
      });
    } catch (error) {
      return toolFailure(error);
    }
  });

  const setSchema = z.object({
    ...projectShape(context),
    designSystemId: uuid,
    versionId: uuid,
  }).strict();
  server.registerTool("set_project_game_design_system", {
    description: "Bind an explicit Game Design System version to a project.",
    inputSchema: setSchema,
    annotations: writeAnnotations,
  }, async (input: z.infer<typeof setSchema>) => {
    try {
      const projectId = projectIdFor(context, input);
      const payload = record(
        await callApp(context, {
          method: "PUT",
          path: `/api/projects/${
            encodeURIComponent(projectId)
          }/game-design-system`,
          body: {
            designSystemId: input.designSystemId,
            versionId: input.versionId,
          },
        }),
      );
      return toolSuccess("Project Game Design System set.", {
        ok: true,
        system: payload.system === null ? null : publicSystem(payload.system),
      });
    } catch (error) {
      return toolFailure(error);
    }
  });

  const clearSchema = z.object(projectShape(context)).strict();
  server.registerTool("clear_project_game_design_system", {
    description: "Clear the current Game Design System binding from a project.",
    inputSchema: clearSchema,
    annotations: writeAnnotations,
  }, async (input: z.infer<typeof clearSchema>) => {
    try {
      const projectId = projectIdFor(context, input);
      await callApp(context, {
        method: "DELETE",
        path: `/api/projects/${
          encodeURIComponent(projectId)
        }/game-design-system`,
      });
      return toolSuccess("Project Game Design System cleared.", { ok: true });
    } catch (error) {
      return toolFailure(error);
    }
  });
}
