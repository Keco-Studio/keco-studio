import { assertEquals, assertMatch, assertRejects } from "@std/assert";
import type { McpServer } from "@mcp/server/mcp.js";
import type { AccountMcpRequestContext, ProjectMcpRequestContext } from "./context.ts";
import { McpDomainError } from "./errors.ts";
import { registerPrompts } from "./prompts.ts";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const DOCUMENT_ID = "22222222-2222-4222-8222-222222222222";

type Handler = (request: { params: { name: string; arguments?: Record<string, string> } }) => Promise<unknown>;

function handlersFor(context: AccountMcpRequestContext | ProjectMcpRequestContext) {
  const handlers: Array<(...args: never[]) => Promise<unknown>> = [];
  const server = {
    server: {
      setRequestHandler(_schema: unknown, handler: (...args: never[]) => Promise<unknown>) {
        handlers.push(handler);
      },
    },
  } as unknown as McpServer;
  registerPrompts(server, context);
  return handlers;
}

const accountContext = {
  mode: "account",
  requestId: "request-1",
  userId: "user-1",
  clientId: "client-1",
  sessionId: "session-1",
  bearerToken: "account-bearer-token",
  supabase: {
    rpc() {
      return Promise.resolve({ data: "editor", error: null });
    },
  },
} as unknown as AccountMcpRequestContext;

const projectContext = {
  mode: "project",
  requestId: "request-1",
  userId: "user-1",
  projectId: PROJECT_ID,
  role: "editor",
  clientId: null,
  bearerToken: "project-bearer-token",
  supabase: {},
} as unknown as ProjectMcpRequestContext;

Deno.test("account prompts require projectId as their first argument", async () => {
  const handlers = handlersFor(accountContext);
  const listed = await handlers[0]() as {
    prompts: Array<{ name: string; description: string; arguments?: unknown }>;
  };
  assertEquals(listed.prompts, [
    { name: "analyze_project", description: "Analyze an accessible project using bounded source reads.", arguments: [{ name: "projectId", required: true }] },
    { name: "build_tables_from_document", description: "Build non-destructive tables from an accessible project document.", arguments: [{ name: "projectId", required: true }, { name: "documentId", required: true }] },
    { name: "update_project_data", description: "Update bounded accessible-project table rows explicitly.", arguments: [{ name: "projectId", required: true }, { name: "tableId", required: true }] },
  ]);

  const result = await (handlers[1] as unknown as Handler)({
    params: {
      name: "build_tables_from_document",
      arguments: { projectId: PROJECT_ID, documentId: DOCUMENT_ID },
    },
  }) as { messages: Array<{ content: { text: string } }> };
  assertMatch(result.messages[0].content.text, new RegExp(PROJECT_ID));
  assertMatch(result.messages[0].content.text, /stable internal project ID/);
  assertMatch(result.messages[0].content.text, /Never silently choose among duplicate project names/);
});

Deno.test("account prompts reject omitted projectId", async () => {
  const handlers = handlersFor(accountContext);
  await assertRejects(
    () => (handlers[1] as unknown as Handler)({
      params: { name: "build_tables_from_document", arguments: { documentId: DOCUMENT_ID } },
    }),
    Error,
    "Invalid prompt arguments.",
  );
});

Deno.test("account prompts reject inaccessible projects and resolve access live", async () => {
  const roles: Array<"editor" | null> = ["editor", null];
  const calls: string[] = [];
  const context = {
    ...accountContext,
    supabase: {
      rpc(name: string) {
        calls.push(name);
        return Promise.resolve({ data: roles.shift() ?? null, error: null });
      },
    },
  } as unknown as AccountMcpRequestContext;
  const handlers = handlersFor(context);
  const request = {
    params: {
      name: "analyze_project",
      arguments: { projectId: PROJECT_ID },
    },
  };

  await (handlers[1] as unknown as Handler)(request);
  const error = await assertRejects(
    () => (handlers[1] as unknown as Handler)(request),
    McpDomainError,
  );
  assertEquals(error.code, "PROJECT_NOT_ACCESSIBLE");
  assertEquals(calls, ["mcp_resolve_project_role", "mcp_resolve_project_role"]);
});

Deno.test("account write prompts deny viewer targets", async () => {
  const context = {
    ...accountContext,
    supabase: {
      rpc() {
        return Promise.resolve({ data: "viewer", error: null });
      },
    },
  } as unknown as AccountMcpRequestContext;
  const handlers = handlersFor(context);
  const error = await assertRejects(
    () => (handlers[1] as unknown as Handler)({
      params: {
        name: "build_tables_from_document",
        arguments: { projectId: PROJECT_ID, documentId: DOCUMENT_ID },
      },
    }),
    McpDomainError,
  );
  assertEquals(error.code, "PROJECT_WRITE_FORBIDDEN");
});

Deno.test("legacy prompt lists and arguments remain unchanged", async () => {
  const handlers = handlersFor(projectContext);
  assertEquals(await handlers[0](), {
    prompts: [
      { name: "analyze_project", description: "Analyze the bound project using bounded source reads.", arguments: undefined },
      { name: "build_tables_from_document", description: "Build non-destructive tables from a project document.", arguments: [{ name: "documentId", required: true }] },
      { name: "update_project_data", description: "Update bounded project table rows explicitly.", arguments: [{ name: "tableId", required: true }] },
    ],
  });
});
