import { assertEquals, assertMatch } from "@std/assert";
import type { AccountMcpRequestContext } from "./context.ts";
import { handleProtocolRequest } from "./server.ts";

const WRITABLE_PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const VIEWER_PROJECT_ID = "22222222-2222-4222-8222-222222222222";

type RpcCall = { name: string; parameters: Record<string, unknown> };

function accountContext(
  calls: RpcCall[],
  options: {
    writable?: boolean;
    resolvedRole?: "admin" | "editor" | "viewer";
    failWritableDiscovery?: boolean;
    delayProjectReadMs?: number;
  } = {},
): AccountMcpRequestContext {
  const writable = options.writable ?? true;
  return {
    mode: "account",
    requestId: "00000000-0000-4000-8000-000000000001",
    userId: "account-user",
    clientId: "account-client",
    sessionId: "00000000-0000-4000-8000-000000000002",
    bearerToken: "account-token",
    supabase: {
      async rpc(name: string, parameters: Record<string, unknown>) {
        calls.push({ name, parameters });
        if (name === "mcp_has_writable_project") {
          if (options.failWritableDiscovery) {
            throw new Error("Writable project discovery failed.");
          }
          return { data: writable, error: null };
        }
        if (name === "mcp_list_accessible_projects") {
          return {
            data: [{
              project_id: WRITABLE_PROJECT_ID,
              name: "Writable project",
              description: null,
              created_at: "2026-07-23T00:00:00.000Z",
              role: writable ? "editor" : "viewer",
            }],
            error: null,
          };
        }
        if (name === "mcp_begin_account_operation") {
          return {
            data: [{
              operation_id: "00000000-0000-4000-8000-000000000003",
              remaining: 119,
              reset_at: new Date(Date.now() + 60_000).toISOString(),
            }],
            error: null,
          };
        }
        if (name === "mcp_resolve_project_role") {
          return { data: options.resolvedRole ?? "editor", error: null };
        }
        if (name === "mcp_read_project_structure") {
          if (options.delayProjectReadMs) {
            await new Promise((resolve) =>
              setTimeout(resolve, options.delayProjectReadMs)
            );
          }
          return {
            data: {
              project: { id: parameters.p_project_id },
              folders: [],
              tables: [],
              documents: [],
            },
            error: null,
          };
        }
        if (name === "mcp_complete_operation") {
          return { data: null, error: null };
        }
        if (name === "mcp_create_table") {
          return { data: [{ table_id: "new-table" }], error: null };
        }
        throw new Error("Unexpected RPC: " + name);
      },
    },
  } as unknown as AccountMcpRequestContext;
}

async function rpc(
  context: AccountMcpRequestContext,
  method: string,
  params: Record<string, unknown> = {},
) {
  const response = await handleProtocolRequest(
    new Request("http://localhost/mcp", {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }),
    context,
  );
  assertEquals(response.status, 200);
  return await response.json() as {
    result?: Record<string, unknown>;
    error?: { code: number; message: string };
  };
}

Deno.test("account schemas require projectId except list_projects", async () => {
  const calls: RpcCall[] = [];
  const message = await rpc(accountContext(calls), "tools/list");
  const tools = message.result?.tools as Array<{
    name: string;
    inputSchema: { properties?: Record<string, unknown>; required?: string[] };
  }>;
  assertEquals(tools.map((tool) => tool.name), [
    "keco_connection_probe",
    "list_projects",
    "list_project_structure",
    "query_table_rows",
    "list_documents",
    "read_document",
    "semantic_search",
    "create_table",
    "create_table_row",
    "update_table_row",
    "create_document",
    "update_document",
  ]);
  const listProjects = tools.find((tool) => tool.name === "list_projects")!;
  assertEquals(Object.keys(listProjects.inputSchema.properties ?? {}), [
    "limit",
    "cursor",
  ]);
  assertEquals(listProjects.inputSchema.required, undefined);
  for (const tool of tools.slice(2)) {
    assertEquals(tool.inputSchema.required?.includes("projectId"), true);
  }
  assertEquals(calls[0].name, "mcp_begin_account_operation");
  assertEquals(calls[1].name, "mcp_has_writable_project");
  assertEquals(calls[1].parameters, undefined);
});

Deno.test("account project reads resolve fresh access before the operation", async () => {
  const calls: RpcCall[] = [];
  const context = accountContext(calls);
  for (let index = 0; index < 2; index += 1) {
    const message = await rpc(context, "tools/call", {
      name: "list_project_structure",
      arguments: { projectId: WRITABLE_PROJECT_ID },
    });
    assertEquals(message.error, undefined);
    assertEquals(message.result?.isError, undefined);
  }
  assertEquals(
    calls.filter((call) => call.name === "mcp_resolve_project_role").length,
    2,
  );
  assertEquals(
    calls.filter((call) => call.name === "mcp_read_project_structure").length,
    2,
  );
  for (
    const call of calls.filter((call) =>
      call.name === "mcp_begin_account_operation"
    )
  ) {
    assertEquals(call.parameters.p_operation, "list_project_structure");
    assertEquals(call.parameters.p_operation_class, "read");
    assertEquals("p_project_id" in call.parameters, false);
  }
});

Deno.test("list_projects uses account read admission and no project selector", async () => {
  const calls: RpcCall[] = [];
  const message = await rpc(accountContext(calls), "tools/call", {
    name: "list_projects",
    arguments: { limit: 50 },
  });
  assertEquals(message.error, undefined);
  const structured = message.result?.structuredContent as Record<
    string,
    unknown
  >;
  assertEquals(structured.ok, true);
  assertEquals(structured.returnedCount, 1);
  const admission = calls.find((call) =>
    call.name === "mcp_begin_account_operation"
  )!;
  assertEquals(admission.parameters.p_operation, "list_projects");
  assertEquals(admission.parameters.p_operation_class, "read");
  assertEquals("p_project_id" in admission.parameters, false);
  assertEquals(
    calls.filter((call) => call.name === "mcp_list_accessible_projects").length,
    1,
  );
  assertEquals(
    calls.filter((call) => call.name === "mcp_has_writable_project").length,
    1,
  );
});

Deno.test("viewer target writes fail even when write tools are advertised", async () => {
  const calls: RpcCall[] = [];
  const message = await rpc(
    accountContext(calls, { writable: true, resolvedRole: "viewer" }),
    "tools/call",
    {
      name: "create_table",
      arguments: {
        projectId: VIEWER_PROJECT_ID,
        name: "Characters",
        fields: [{ label: "Name", dataType: "string" }],
      },
    },
  );
  assertEquals(message.error, undefined);
  assertEquals(message.result?.isError, true);
  assertMatch(JSON.stringify(message.result), /PROJECT_WRITE_FORBIDDEN/);
  assertEquals(calls.some((call) => call.name === "mcp_create_table"), false);
});

Deno.test("account discovery omits writes when every accessible project is viewer", async () => {
  const calls: RpcCall[] = [];
  const message = await rpc(
    accountContext(calls, { writable: false }),
    "tools/list",
  );
  const names = (message.result?.tools as Array<{ name: string }>).map((tool) =>
    tool.name
  );
  assertEquals(names.includes("create_table"), false);
  assertEquals(names.includes("update_document"), false);
  assertEquals(names.includes("list_projects"), true);
});

Deno.test("writable discovery failure fails closed while account safe tools remain callable", async () => {
  const calls: RpcCall[] = [];
  const context = accountContext(calls, { failWritableDiscovery: true });
  const discovery = await rpc(context, "tools/list");
  const names = (discovery.result?.tools as Array<{ name: string }>).map(
    (tool) => tool.name,
  );
  assertEquals(names.includes("keco_connection_probe"), true);
  assertEquals(names.includes("list_projects"), true);
  assertEquals(names.includes("list_project_structure"), true);
  assertEquals(names.includes("create_table"), false);

  const probe = await rpc(context, "tools/call", {
    name: "keco_connection_probe",
    arguments: {},
  });
  assertEquals(probe.result?.isError, undefined);

  const projects = await rpc(context, "tools/call", {
    name: "list_projects",
    arguments: {},
  });
  assertEquals(projects.result?.isError, undefined);

  const structure = await rpc(context, "tools/call", {
    name: "list_project_structure",
    arguments: { projectId: WRITABLE_PROJECT_ID },
  });
  assertEquals(structure.result?.isError, undefined);
  assertEquals(
    calls.some((call) => call.name === "mcp_create_table"),
    false,
  );
});

Deno.test("account project database work persists through the account operation timing", async () => {
  const calls: RpcCall[] = [];
  const message = await rpc(
    accountContext(calls, { delayProjectReadMs: 15 }),
    "tools/call",
    {
      name: "list_project_structure",
      arguments: { projectId: WRITABLE_PROJECT_ID },
    },
  );
  assertEquals(message.result?.isError, undefined);
  const completion = calls.find((call) =>
    call.name === "mcp_complete_operation"
  )!;
  assertEquals(Number(completion.parameters.p_database_ms) > 0, true);
});
