import { assertEquals, assertMatch, assertRejects } from "@std/assert";
import type { McpServer } from "@mcp/server/mcp.js";
import type { AccountMcpRequestContext, ProjectMcpRequestContext } from "./context.ts";
import { registerResources } from "./resources.ts";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const DUPLICATE_PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const TABLE_ID = "33333333-3333-4333-8333-333333333333";
const DOCUMENT_ID = "44444444-4444-4444-8444-444444444444";

type Handler = (request: { params: { uri: string } }) => Promise<unknown>;

function handlersFor(context: AccountMcpRequestContext | ProjectMcpRequestContext) {
  const handlers: Array<(...args: never[]) => Promise<unknown>> = [];
  const server = {
    server: {
      setRequestHandler(_schema: unknown, handler: (...args: never[]) => Promise<unknown>) {
        handlers.push(handler);
      },
    },
  } as unknown as McpServer;
  registerResources(server, context);
  return handlers;
}

function accountContext(
  rpc: (name: string, parameters: Record<string, unknown>) => Promise<unknown>,
) {
  return {
    mode: "account",
    requestId: "request-1",
    userId: "user-1",
    clientId: "client-1",
    sessionId: "session-1",
    bearerToken: "account-bearer-token",
    supabase: { rpc },
  } as unknown as AccountMcpRequestContext;
}

Deno.test("account resources list projects and preserve duplicate names", async () => {
  const calls: Array<{ name: string; parameters: Record<string, unknown> }> = [];
  const handlers = handlersFor(accountContext(async (name, parameters) => {
    calls.push({ name, parameters });
    return {
      data: [
        {
          project_id: PROJECT_ID,
          name: "Game Design",
          description: null,
          created_at: "2026-07-23T00:00:00.000Z",
          role: "admin",
        },
        {
          project_id: DUPLICATE_PROJECT_ID,
          name: "Game Design",
          description: null,
          created_at: "2026-07-22T00:00:00.000Z",
          role: "viewer",
        },
      ],
      error: null,
    };
  }));

  assertEquals(await handlers[0](), {
    resources: [{ uri: "keco://projects", name: "projects", mimeType: "application/json" }],
  });
  assertEquals(await handlers[1](), {
    resourceTemplates: [
      { uriTemplate: "keco://projects/{projectId}", name: "project", mimeType: "application/json" },
      { uriTemplate: "keco://projects/{projectId}/structure", name: "project-structure", mimeType: "application/json" },
      { uriTemplate: "keco://projects/{projectId}/tables/{tableId}/schema", name: "table-schema", mimeType: "application/json" },
      { uriTemplate: "keco://projects/{projectId}/tables/{tableId}/rows{?limit,cursor}", name: "table-rows", mimeType: "application/json" },
      { uriTemplate: "keco://projects/{projectId}/documents/{documentId}", name: "document", mimeType: "application/json" },
    ],
  });

  const result = await (handlers[2] as unknown as Handler)({ params: { uri: "keco://projects" } }) as {
    contents: Array<{ text: string }>;
  };
  const page = JSON.parse(result.contents[0].text);
  assertEquals(page.items.map((item: { name: string; projectId: string }) => [item.name, item.projectId]), [
    ["Game Design", PROJECT_ID],
    ["Game Design", DUPLICATE_PROJECT_ID],
  ]);
  assertEquals(calls, [{
    name: "mcp_list_accessible_projects",
    parameters: {
      p_limit: 51,
      p_before_created_at: null,
      p_after_project_id: null,
    },
  }]);
});

Deno.test("account project resources reauthorize before their bounded read", async () => {
  const calls: Array<{ name: string; parameters: Record<string, unknown> }> = [];
  const handlers = handlersFor(accountContext(async (name, parameters) => {
    calls.push({ name, parameters });
    if (name === "mcp_resolve_project_role") return { data: "editor", error: null };
    if (name === "mcp_read_project_structure") {
      return {
        data: {
          project: { id: PROJECT_ID, name: "Bound project" },
          folders: [],
          tables: [{ id: TABLE_ID, name: "Bound table" }],
        },
        error: null,
      };
    }
    return { data: null, error: null };
  }));

  const result = await (handlers[2] as unknown as Handler)({
    params: { uri: `keco://projects/${PROJECT_ID}/tables/${TABLE_ID}/schema` },
  }) as { contents: Array<{ text: string }> };
  assertMatch(result.contents[0].text, /Bound table/);
  assertEquals(calls, [
    { name: "mcp_resolve_project_role", parameters: { p_project_id: PROJECT_ID } },
    { name: "mcp_read_project_structure", parameters: { p_project_id: PROJECT_ID } },
  ]);
});

Deno.test("account project resources reject malformed IDs before access resolution", async () => {
  const calls: string[] = [];
  const handlers = handlersFor(accountContext(async (name) => {
    calls.push(name);
    return { data: null, error: null };
  }));

  const error = await assertRejects(
    () => (handlers[2] as unknown as Handler)({
      params: { uri: `keco://projects/not-a-uuid/documents/${DOCUMENT_ID}` },
    }),
  );
  assertMatch(String(error), /INVALID_RESOURCE_URI/);
  assertEquals(calls, []);
});
