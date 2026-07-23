import type {
  AccountMcpRequestContext,
  ProjectMcpRequestContext,
} from "./context.ts";
import { decodeCursor, encodeCursor } from "./cursor.ts";
import { McpDomainError } from "./errors.ts";
import { validateLimit } from "./limits.ts";
import { inheritMcpPhaseTimings, measureMcpPhase } from "./telemetry.ts";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROJECT_CURSOR_KIND = "account_projects";

type ProjectRole = "admin" | "editor" | "viewer";
type ProjectCursorPosition = { projectId: string };
type AccessibleProjectRow = {
  project_id: string;
  name: string;
  description: string | null;
  created_at: string;
  role: ProjectRole;
};

export type ProjectListItem = {
  projectId: string;
  name: string;
  description: string | null;
  createdAt: string;
  role: ProjectRole;
  capabilities: { read: true; create: boolean; update: boolean };
};

export type ProjectListPage = {
  items: ProjectListItem[];
  returnedCount: number;
  hasMore: boolean;
  nextCursor: string | null;
};

function cursorSecret(): string {
  const value = Deno.env.get("MCP_CURSOR_SECRET");
  if (!value) throw new Error("MCP_CURSOR_SECRET is required.");
  return value;
}

function internalError(message: string): McpDomainError {
  return new McpDomainError("INTERNAL_ERROR", message);
}

function invalidCursor(): never {
  throw new McpDomainError(
    "INVALID_CURSOR",
    "The pagination cursor is invalid or expired.",
  );
}

function isProjectRole(value: unknown): value is ProjectRole {
  return value === "admin" || value === "editor" || value === "viewer";
}

function isProjectCursorPosition(
  value: unknown,
): value is ProjectCursorPosition {
  return !!value && typeof value === "object" && !Array.isArray(value) &&
    typeof (value as Record<string, unknown>).projectId === "string" &&
    UUID.test((value as Record<string, unknown>).projectId as string);
}

function isAccessibleProjectRow(value: unknown): value is AccessibleProjectRow {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.project_id === "string" && UUID.test(row.project_id) &&
    typeof row.name === "string" &&
    (typeof row.description === "string" || row.description === null) &&
    typeof row.created_at === "string" && isProjectRole(row.role);
}

function projectCapabilities(
  role: ProjectRole,
): ProjectListItem["capabilities"] {
  const writable = role === "admin" || role === "editor";
  return { read: true, create: writable, update: writable };
}

async function listProjectRows(
  context: AccountMcpRequestContext,
  limit: number,
  position: ProjectCursorPosition | null,
): Promise<AccessibleProjectRow[]> {
  const { data, error } = await measureMcpPhase(
    context,
    "database",
    async () =>
      await context.supabase.rpc(
        "mcp_list_accessible_projects",
        {
          p_limit: limit,
          p_before_created_at: null,
          p_after_project_id: position?.projectId ?? null,
        },
      ),
  );
  if (error || !Array.isArray(data) || !data.every(isAccessibleProjectRow)) {
    throw internalError("The accessible projects could not be listed.");
  }
  return data;
}

export async function listAccessibleProjects(
  context: AccountMcpRequestContext,
  input: { limit?: number; cursor?: string } = {},
): Promise<ProjectListPage> {
  const limit = validateLimit(input.limit, { defaultValue: 50, maximum: 100 });
  let position: ProjectCursorPosition | null = null;
  if (input.cursor) {
    const decoded = await decodeCursor(
      input.cursor,
      {
        kind: PROJECT_CURSOR_KIND,
        scope: "account",
        userId: context.userId,
      },
      cursorSecret(),
    );
    if (!isProjectCursorPosition(decoded)) invalidCursor();
    position = decoded;
  }
  const rows = await listProjectRows(context, limit + 1, position);
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit).map((row) => ({
    projectId: row.project_id,
    name: row.name,
    description: row.description,
    createdAt: row.created_at,
    role: row.role,
    capabilities: projectCapabilities(row.role),
  }));
  const last = items.at(-1);
  return {
    items,
    returnedCount: items.length,
    hasMore,
    nextCursor: hasMore && last
      ? await encodeCursor(
        {
          kind: PROJECT_CURSOR_KIND,
          scope: "account",
          userId: context.userId,
        },
        { projectId: last.projectId },
        cursorSecret(),
      )
      : null,
  };
}

function derivedProjectContext(
  context: AccountMcpRequestContext,
  projectId: string,
  role: ProjectRole,
): ProjectMcpRequestContext {
  const derived: Record<string, unknown> = {
    mode: "project",
    requestId: context.requestId,
    userId: context.userId,
    projectId,
    role,
    clientId: context.clientId,
  };
  Object.defineProperties(derived, {
    bearerToken: {
      value: context.bearerToken,
      enumerable: false,
      writable: false,
      configurable: false,
    },
    supabase: {
      value: context.supabase,
      enumerable: false,
      writable: false,
      configurable: false,
    },
  });
  const projectContext = Object.freeze(derived) as ProjectMcpRequestContext;
  inheritMcpPhaseTimings(context, projectContext);
  return projectContext;
}

export async function authorizeAccountProject(
  context: AccountMcpRequestContext,
  projectId: string,
  access: "read" | "write",
): Promise<ProjectMcpRequestContext> {
  if (!UUID.test(projectId)) {
    throw new McpDomainError(
      "PROJECT_NOT_ACCESSIBLE",
      "The project is not accessible.",
    );
  }
  const { data, error } = await measureMcpPhase(
    context,
    "database",
    async () =>
      await context.supabase.rpc(
        "mcp_resolve_project_role",
        { p_project_id: projectId },
      ),
  );
  if (error || (data !== null && !isProjectRole(data))) {
    throw internalError("The project access could not be resolved.");
  }
  if (data === null) {
    throw new McpDomainError(
      "PROJECT_NOT_ACCESSIBLE",
      "The project is not accessible.",
    );
  }
  if (access === "write" && data === "viewer") {
    throw new McpDomainError(
      "PROJECT_WRITE_FORBIDDEN",
      "Write access is not available for this project.",
    );
  }
  return derivedProjectContext(context, projectId, data);
}

export async function accountHasWritableProject(
  context: AccountMcpRequestContext,
): Promise<boolean> {
  const { data, error } = await measureMcpPhase(
    context,
    "database",
    async () => await context.supabase.rpc("mcp_has_writable_project"),
  );
  if (error || typeof data !== "boolean") {
    throw internalError("The writable project access could not be resolved.");
  }
  return data;
}
