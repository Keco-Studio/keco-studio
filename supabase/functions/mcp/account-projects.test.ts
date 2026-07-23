import { assertEquals, assertRejects, assertStrictEquals } from "@std/assert";
import type { AccountMcpRequestContext } from "./context.ts";
import { McpDomainError } from "./errors.ts";
import {
  accountHasWritableProject,
  authorizeAccountProject,
  listAccessibleProjects,
} from "./account-projects.ts";

const PROJECT_A = "11111111-1111-4111-8111-111111111111";
const PROJECT_B = "22222222-2222-4222-8222-222222222222";
const PROJECT_C = "33333333-3333-4333-8333-333333333333";
const CURSOR_SECRET = "account-project-cursor-secret";

type RpcCall = { name: string; parameters: Record<string, unknown> };

function projectRow(
  projectId: string,
  role: "admin" | "editor" | "viewer",
  createdAt: string,
) {
  return {
    project_id: projectId,
    name: `Project ${projectId.slice(0, 1)}`,
    description: null,
    created_at: createdAt,
    role,
  };
}

function makeContext(
  rpc: (name: string, parameters: Record<string, unknown>) => Promise<unknown>,
  userId = "user-1",
) {
  const client = { rpc: async (name: string, parameters: Record<string, unknown>) =>
    await rpc(name, parameters) };
  const context = {
    mode: "account",
    requestId: "request-1",
    userId,
    clientId: "client-1",
    sessionId: "session-1",
    bearerToken: "account-bearer-token",
    supabase: client,
  } as unknown as AccountMcpRequestContext;
  return { context, client };
}

Deno.test("lists a bounded page of accessible projects with role capabilities", async () => {
  Deno.env.set("MCP_CURSOR_SECRET", CURSOR_SECRET);
  const calls: RpcCall[] = [];
  const rows = [
    projectRow(PROJECT_A, "admin", "2026-07-23T03:00:00.000Z"),
    projectRow(PROJECT_B, "viewer", "2026-07-22T03:00:00.000Z"),
    projectRow(PROJECT_C, "editor", "2026-07-21T03:00:00.000Z"),
  ];
  const { context } = makeContext(async (name, parameters) => {
    calls.push({ name, parameters });
    return { data: rows, error: null };
  });

  const page = await listAccessibleProjects(context, { limit: 2 });

  assertEquals(calls, [{
    name: "mcp_list_accessible_projects",
    parameters: {
      p_limit: 3,
      p_before_created_at: null,
      p_after_project_id: null,
    },
  }]);
  assertEquals(page.items, [
    {
      projectId: PROJECT_A,
      name: "Project 1",
      description: null,
      createdAt: "2026-07-23T03:00:00.000Z",
      role: "admin",
      capabilities: { read: true, create: true, update: true },
    },
    {
      projectId: PROJECT_B,
      name: "Project 2",
      description: null,
      createdAt: "2026-07-22T03:00:00.000Z",
      role: "viewer",
      capabilities: { read: true, create: false, update: false },
    },
  ]);
  assertEquals(page.returnedCount, 2);
  assertEquals(page.hasMore, true);
  assertEquals(typeof page.nextCursor, "string");
});

Deno.test("project listing replays its cursor as the database sort tuple", async () => {
  Deno.env.set("MCP_CURSOR_SECRET", CURSOR_SECRET);
  const calls: RpcCall[] = [];
  const { context } = makeContext(async (name, parameters) => {
    calls.push({ name, parameters });
    if (calls.length === 1) {
      return {
        data: [
          projectRow(PROJECT_A, "admin", "2026-07-23T03:00:00.000Z"),
          projectRow(PROJECT_B, "editor", "2026-07-22T03:00:00.000Z"),
        ],
        error: null,
      };
    }
    return { data: [projectRow(PROJECT_C, "viewer", "2026-07-21T03:00:00.000Z")], error: null };
  });

  const first = await listAccessibleProjects(context, { limit: 1 });
  const second = await listAccessibleProjects(context, { limit: 1, cursor: first.nextCursor ?? "" });

  assertEquals(second.items.map((item) => item.projectId), [PROJECT_C]);
  assertEquals(calls[1], {
    name: "mcp_list_accessible_projects",
    parameters: {
      p_limit: 2,
      p_before_created_at: "2026-07-23T03:00:00.000Z",
      p_after_project_id: PROJECT_A,
    },
  });
});

Deno.test("account project authorization resolves each current role and derives a fresh project context", async () => {
  const roles: Array<"editor" | "viewer"> = ["editor", "viewer"];
  const calls: RpcCall[] = [];
  const { context, client } = makeContext(async (name, parameters) => {
    calls.push({ name, parameters });
    return { data: roles.shift() ?? null, error: null };
  });

  const authorized = await authorizeAccountProject(context, PROJECT_A, "write");
  const denied = await assertRejects(
    () => authorizeAccountProject(context, PROJECT_A, "write"),
    McpDomainError,
  );

  assertEquals(authorized.mode, "project");
  assertEquals(authorized.role, "editor");
  assertEquals(authorized.projectId, PROJECT_A);
  assertStrictEquals(authorized.supabase, client);
  assertEquals(JSON.stringify(authorized).includes("account-bearer-token"), false);
  assertEquals(Object.isFrozen(authorized), true);
  assertEquals(context.mode, "account");
  assertEquals(denied.code, "PROJECT_WRITE_FORBIDDEN");
  assertEquals(calls, [
    { name: "mcp_resolve_project_role", parameters: { p_project_id: PROJECT_A } },
    { name: "mcp_resolve_project_role", parameters: { p_project_id: PROJECT_A } },
  ]);
});

Deno.test("account project authorization hides malformed and inaccessible project IDs", async () => {
  const { context } = makeContext(async () => ({ data: null, error: null }));
  for (const projectId of ["not-a-uuid", PROJECT_A]) {
    const error = await assertRejects(
      () => authorizeAccountProject(context, projectId, "read"),
      McpDomainError,
    );
    assertEquals(error.code, "PROJECT_NOT_ACCESSIBLE");
  }
});

Deno.test("writable project discovery pages until it finds a current editor or admin", async () => {
  const firstPage = Array.from(
    { length: 100 },
    (_, index) => projectRow(
      `${String(index + 10).padStart(8, "0")}-1111-4111-8111-111111111111`,
      "viewer",
      `2026-07-23T00:00:${String(59 - index % 60).padStart(2, "0")}.000Z`,
    ),
  );
  const calls: RpcCall[] = [];
  const { context } = makeContext(async (name, parameters) => {
    calls.push({ name, parameters });
    return calls.length === 1
      ? { data: firstPage, error: null }
      : { data: [projectRow(PROJECT_A, "editor", "2026-07-20T00:00:00.000Z")], error: null };
  });

  assertEquals(await accountHasWritableProject(context), true);
  assertEquals(calls.length, 2);
  assertEquals(calls[0].parameters.p_limit, 100);
  assertEquals(calls[1].parameters.p_before_created_at, firstPage.at(-1)?.created_at);
});
