import type { McpServer } from "@mcp/server/mcp.js";
import { z } from "zod";
import type { ProjectMcpRequestContext } from "./context.ts";
import { toolFailure, toolSuccess } from "./results.ts";
import {
  listDocuments,
  listProjectStructure,
  queryTableRows,
  readDocument,
  semanticSearch,
} from "./operations.ts";
import { readStoryGraph } from "./story-graph.ts";

const uuid = z.string().uuid();
const annotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

type ProjectContextResolver = (
  projectId: string,
) => Promise<ProjectMcpRequestContext>;

async function run(
  summary: string,
  operation: () => Promise<Record<string, unknown>>,
) {
  try {
    const value = await operation();
    return toolSuccess(summary, { ok: true, ...value });
  } catch (error) {
    return toolFailure(error);
  }
}

function withoutProjectId<T extends Record<string, unknown>>(
  input: T,
): Omit<T, "projectId"> {
  const { projectId: _projectId, ...operationInput } = input;
  return operationInput;
}

function registerReadToolSet(
  server: McpServer,
  legacyContext: ProjectMcpRequestContext | null,
  resolveProject: ProjectContextResolver | null,
): void {
  const projectShape = resolveProject ? { projectId: uuid } : {};
  const contextFor = (input: Record<string, unknown>) =>
    resolveProject
      ? resolveProject(input.projectId as string)
      : Promise.resolve(legacyContext as ProjectMcpRequestContext);

  const structureSchema = z.object({ ...projectShape }).strict();
  server.registerTool(
    "list_project_structure",
    {
      description:
        "List project metadata, folders, table schemas, and bounded document summaries.",
      inputSchema: structureSchema,
      annotations,
    },
    async (input: z.infer<typeof structureSchema>) =>
      run(
        "Project structure loaded.",
        async () => listProjectStructure(await contextFor(input)),
      ),
  );

  const queryRowsSchema = z.object({
    ...projectShape,
    tableId: uuid,
    limit: z.number().int().min(1).max(200).optional(),
    cursor: z.string().min(1).max(4096).optional(),
    rowIndex: z.number().int().min(1).optional(),
    fields: z.array(z.string().min(1).max(200)).min(1).max(100).optional(),
  }).strict().refine(
    (value) => !(value.cursor && value.rowIndex !== undefined),
    "rowIndex cannot be combined with cursor.",
  );
  server.registerTool(
    "query_table_rows",
    {
      description: "Read one bounded table page using semantic field labels.",
      inputSchema: queryRowsSchema,
      annotations,
    },
    async (input: z.infer<typeof queryRowsSchema>) =>
      run("Table rows loaded.", async () => {
        const context = await contextFor(input);
        return queryTableRows(context, withoutProjectId(input));
      }),
  );

  const listDocumentsSchema = z.object({
    ...projectShape,
    limit: z.number().int().min(1).max(200).optional(),
    cursor: z.string().min(1).max(4096).optional(),
  }).strict();
  server.registerTool(
    "list_documents",
    {
      description:
        "List a deterministic bounded page of project document metadata.",
      inputSchema: listDocumentsSchema,
      annotations,
    },
    async (input: z.infer<typeof listDocumentsSchema>) =>
      run("Documents loaded.", async () => {
        const context = await contextFor(input);
        return listDocuments(context, withoutProjectId(input));
      }),
  );

  const readDocumentSchema = z.object({
    ...projectShape,
    documentId: uuid,
    mode: z.enum(["full", "outline", "heading", "lines"]).optional(),
    heading: z.string().min(1).max(500).optional(),
    lineStart: z.number().int().min(1).optional(),
    lineEnd: z.number().int().min(1).optional(),
  }).strict().superRefine((value, issue) => {
    const mode = value.mode ?? "full";
    if (mode === "heading" && !value.heading) {
      issue.addIssue({ code: "custom", message: "heading is required." });
    }
    if (mode !== "heading" && value.heading) {
      issue.addIssue({
        code: "custom",
        message: "heading requires heading mode.",
      });
    }
    if (mode === "lines" && (!value.lineStart || !value.lineEnd)) {
      issue.addIssue({
        code: "custom",
        message: "lineStart and lineEnd are required.",
      });
    }
    if (mode !== "lines" && (value.lineStart || value.lineEnd)) {
      issue.addIssue({
        code: "custom",
        message: "line bounds require lines mode.",
      });
    }
  });
  server.registerTool(
    "read_document",
    {
      description:
        "Read authoritative document Markdown in full, outline, heading, or line mode.",
      inputSchema: readDocumentSchema,
      annotations,
    },
    async (input: z.infer<typeof readDocumentSchema>) =>
      run("Document loaded.", async () => {
        const context = await contextFor(input);
        return readDocument(context, withoutProjectId(input));
      }),
  );

  const storyGraphSchema = z.object({
    ...projectShape,
    libraryId: uuid,
    limit: z.number().int().min(1).max(200).optional(),
    cursor: z.string().min(1).max(4096).optional(),
  }).strict();
  server.registerTool(
    "read_story_graph",
    {
      description:
        "Read and validate a complete document-derived Script story graph. Follow nextCursor until hasMore is false; if STORY_GRAPH_CONFLICT is returned, discard prior pages and restart. Obtain libraryId from list_project_structure.",
      inputSchema: storyGraphSchema,
      annotations,
    },
    async (input: z.infer<typeof storyGraphSchema>) =>
      run("Story graph loaded.", async () => {
        const context = await contextFor(input);
        return await readStoryGraph(context, withoutProjectId(input));
      }),
  );

  const searchSchema = z.object({
    ...projectShape,
    query: z.string().min(1).max(4000),
    limit: z.number().int().min(1).max(30).optional(),
    source: z.enum(["all", "tables", "documents"]).optional(),
  }).strict();
  server.registerTool(
    "semantic_search",
    {
      description:
        "Search project tables and documents with explicit semantic or text/fuzzy mode.",
      inputSchema: searchSchema,
      annotations,
    },
    async (input: z.infer<typeof searchSchema>) =>
      run("Search completed.", async () => {
        const context = await contextFor(input);
        return semanticSearch(context, withoutProjectId(input));
      }),
  );
}

export function registerReadTools(
  server: McpServer,
  context: ProjectMcpRequestContext,
): void {
  registerReadToolSet(server, context, null);
}

export function registerAccountReadTools(
  server: McpServer,
  resolveProject: ProjectContextResolver,
): void {
  registerReadToolSet(server, null, resolveProject);
}
