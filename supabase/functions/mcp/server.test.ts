import { assertEquals, assertMatch } from "@std/assert";
import { LATEST_PROTOCOL_VERSION } from "@mcp/types.js";
import { handleProtocolRequest } from "./server.ts";
import type {
  McpRequestContext,
  ProjectMcpRequestContext,
} from "./context.ts";

const context = {
  mode: "project",
  requestId: "00000000-0000-4000-8000-000000000001",
  userId: "user-1",
  projectId: "11111111-1111-4111-8111-111111111111",
  role: "editor",
  clientId: null,
  bearerToken: "test-token",
  supabase: {
    rpc(name: string) {
      if (name === "mcp_begin_operation") {
        return Promise.resolve({
          data: [{
            operation_id: "00000000-0000-4000-8000-000000000002",
            remaining: 239,
            reset_at: new Date(Date.now() + 60_000).toISOString(),
          }],
          error: null,
        });
      }
      if (name === "mcp_complete_operation") {
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
  },
} as unknown as ProjectMcpRequestContext;

const accountContext = {
  mode: "account",
  requestId: "00000000-0000-4000-8000-000000000010",
  userId: "user-1",
  clientId: "client-1",
  sessionId: "11111111-1111-4111-8111-111111111111",
  bearerToken: "test-account-token",
  supabase: {
    rpc() {
      throw new Error("account mode must not use project telemetry");
    },
  },
} as unknown as McpRequestContext;

async function rpc(
  method: string,
  params: Record<string, unknown> = {},
  requestContext: McpRequestContext = context,
) {
  const response = await handleProtocolRequest(
    new Request("http://localhost/mcp/project", {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }),
    requestContext,
  );
  assertEquals(response.status, 200);
  return await response.json() as {
    result?: Record<string, unknown>;
    error?: { code: number; message: string };
  };
}

Deno.test("initialize declares tools resources and prompts", async () => {
  const message = await rpc("initialize", {
    protocolVersion: LATEST_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: "phase-1-test", version: "1.0.0" },
  });
  assertEquals(message.error, undefined);
  assertEquals(message.result?.protocolVersion, LATEST_PROTOCOL_VERSION);
  assertEquals(message.result?.serverInfo, {
    name: "keco-mcp",
    version: "0.3.1",
  });
  assertEquals(message.result?.capabilities, {
    tools: { listChanged: true },
    resources: { listChanged: false },
    prompts: { listChanged: true },
  });
});

Deno.test("tools/list exposes the editor probe, reads, and writes", async () => {
  const message = await rpc("tools/list");
  assertEquals(message.error, undefined);
  const names = (message.result?.tools as Array<{ name: string }>).map((tool) =>
    tool.name
  );
  assertEquals(names, [
    "keco_connection_probe",
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
});

Deno.test("viewer tools/list excludes every write tool", async () => {
  const message = await rpc(
    "tools/list",
    {},
    { ...context, role: "viewer" } as McpRequestContext,
  );
  assertEquals(
    (message.result?.tools as Array<{ name: string }>).map((tool) => tool.name),
    [
      "keco_connection_probe",
      "list_project_structure",
      "query_table_rows",
      "list_documents",
      "read_document",
      "semantic_search",
    ],
  );
});

Deno.test("resources and prompts are discoverable", async () => {
  const resources = await rpc("resources/list");
  assertEquals(
    (resources.result?.resources as Array<{ uri: string }>).map((x) => x.uri),
    ["keco://project", "keco://tables", "keco://documents"],
  );
  const templates = await rpc("resources/templates/list");
  assertEquals((templates.result?.resourceTemplates as unknown[]).length, 4);
  const prompts = await rpc("prompts/list");
  assertEquals(
    (prompts.result?.prompts as Array<{ name: string }>).map((x) => x.name),
    ["analyze_project", "build_tables_from_document", "update_project_data"],
  );
});

Deno.test("ping returns an empty result", async () => {
  const message = await rpc("ping");
  assertEquals(message.error, undefined);
  assertEquals(message.result, {});
});

Deno.test("account mode exposes only the connection probe without project telemetry", async () => {
  const initialize = await rpc(
    "initialize",
    {
      protocolVersion: LATEST_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "account-test", version: "1.0.0" },
    },
    accountContext,
  );
  assertEquals(initialize.error, undefined);
  assertEquals(initialize.result?.capabilities, {
    tools: { listChanged: true },
  });

  const tools = await rpc("tools/list", {}, accountContext);
  assertEquals(tools.error, undefined);
  assertEquals(
    (tools.result?.tools as Array<{ name: string }>).map((tool) => tool.name),
    ["keco_connection_probe"],
  );

  const ping = await rpc("ping", {}, accountContext);
  assertEquals(ping.error, undefined);
  assertEquals(ping.result, {});
});

Deno.test("strict tool schemas reject unknown project selectors before execution", async () => {
  const message = await rpc("tools/call", {
    name: "list_project_structure",
    arguments: { projectId: "22222222-2222-4222-8222-222222222222" },
  });
  assertEquals(message.error, undefined);
  assertEquals(message.result?.isError, true);
  assertMatch(JSON.stringify(message.result), /Unrecognized key/);
});

Deno.test("unknown tools and malformed protocol bodies are admitted and completed once", async () => {
  const calls: Array<{ name: string; parameters: Record<string, unknown> }> =
    [];
  const audited = {
    ...context,
    supabase: {
      async rpc(name: string, parameters: Record<string, unknown>) {
        calls.push({ name, parameters });
        if (name === "mcp_begin_operation") {
          return {
            data: [{
              operation_id: "00000000-0000-4000-8000-000000000009",
              remaining: 239,
              reset_at: new Date(Date.now() + 60_000).toISOString(),
            }],
            error: null,
          };
        }
        return { data: null, error: null };
      },
    },
  } as unknown as McpRequestContext;
  const unknown = await rpc(
    "tools/call",
    { name: "not_a_tool", arguments: {} },
    audited,
  );
  assertEquals(unknown.error, undefined);
  assertEquals(unknown.result?.isError, true);
  assertEquals(calls.map((call) => call.name), [
    "mcp_begin_operation",
    "mcp_complete_operation",
  ]);
  assertEquals(calls[0].parameters.p_operation, "unknown_tool");
  assertEquals(calls[0].parameters.p_operation_class, "static");

  calls.length = 0;
  const response = await handleProtocolRequest(
    new Request("http://localhost/mcp/project", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: "{invalid",
    }),
    audited,
  );
  assertEquals(response.status, 400);
  assertEquals(calls.map((call) => call.name), [
    "mcp_begin_operation",
    "mcp_complete_operation",
  ]);
  assertEquals(calls[0].parameters.p_operation, "protocol_invalid_request");
});

Deno.test("prompts/get is strict and static", async () => {
  const invalid = await rpc("prompts/get", {
    name: "analyze_project",
    arguments: { projectId: "22222222-2222-4222-8222-222222222222" },
  });
  assertEquals(invalid.error?.code, -32602);
  const valid = await rpc("prompts/get", {
    name: "build_tables_from_document",
    arguments: { documentId: "22222222-2222-4222-8222-222222222222" },
  });
  assertEquals(valid.error, undefined);
  assertMatch(
    String(
      (valid.result?.messages as Array<{ content: { text: string } }>)[0]
        .content.text,
    ),
    /22222222-2222-4222-8222-222222222222/,
  );
});

Deno.test("resources/read rejects non-canonical and unknown query parameters", async () => {
  for (
    const uri of [
      "keco://documents?projectId=22222222-2222-4222-8222-222222222222",
      "keco://tables/22222222-2222-4222-8222-222222222222/rows#fragment",
      "keco://user:pass@documents",
      "keco://documents/%2e%2e/secret",
    ]
  ) {
    const message = await rpc("resources/read", { uri });
    assertEquals(message.error?.code, -32602);
    assertMatch(message.error?.message ?? "", /INVALID_RESOURCE_URI/);
  }
});

Deno.test("resources/read executes a bounded project structure read", async () => {
  const calls: string[] = [];
  const resourceContext = {
    ...context,
    supabase: {
      async rpc(name: string) {
        calls.push(name);
        if (name === "mcp_begin_operation") {
          return {
            data: [{
              operation_id: "00000000-0000-4000-8000-000000000004",
              remaining: 119,
              reset_at: new Date(Date.now() + 60_000).toISOString(),
            }],
            error: null,
          };
        }
        if (name === "mcp_read_project_structure") {
          return {
            data: {
              project: { id: context.projectId, name: "Bound project" },
              folders: [],
              tables: [],
              documents: [],
            },
            error: null,
          };
        }
        return { data: null, error: null };
      },
    },
  } as unknown as McpRequestContext;
  const message = await rpc("resources/read", {
    uri: "keco://project/structure",
  }, resourceContext);
  assertEquals(message.error, undefined);
  const contents = message.result?.contents as Array<{ text: string }>;
  assertMatch(contents[0].text, /Bound project/);
  assertEquals(calls, [
    "mcp_begin_operation",
    "mcp_read_project_structure",
    "mcp_complete_operation",
  ]);
});

Deno.test("create_table makes one primary atomic RPC between telemetry calls", async () => {
  const calls: Array<{ name: string; parameters?: Record<string, unknown> }> =
    [];
  const writeContext = {
    ...context,
    supabase: {
      async rpc(name: string, parameters: Record<string, unknown>) {
        calls.push({ name, parameters });
        if (name === "mcp_begin_operation") {
          return {
            data: [{
              operation_id: "00000000-0000-4000-8000-000000000005",
              remaining: 29,
              reset_at: new Date(Date.now() + 60_000).toISOString(),
            }],
            error: null,
          };
        }
        if (name === "mcp_create_table") {
          return {
            data: [{ table_id: "new-table" }],
            error: null,
          };
        }
        return { data: null, error: null };
      },
    },
  } as unknown as McpRequestContext;
  const message = await rpc("tools/call", {
    name: "create_table",
    arguments: {
      name: "Characters",
      fields: [{ label: "Name", dataType: "string", required: true }],
    },
  }, writeContext);
  assertEquals(message.error, undefined);
  assertEquals(message.result?.isError, undefined);
  assertEquals(calls.map((call) => call.name), [
    "mcp_begin_operation",
    "mcp_create_table",
    "mcp_complete_operation",
  ]);
  const primary = calls[1].parameters ?? {};
  assertEquals(primary.p_project_id, context.projectId);
  assertEquals(Array.isArray(primary.p_fields), true);
  assertMatch(JSON.stringify(primary.p_fields), /"id":/);
});

Deno.test("stale document state token is rejected before codec or privileged replacement", async () => {
  const calls: string[] = [];
  const head = {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Document",
    content: "# Stored",
    yjs_state: "snapshot",
    collab_epoch: 3,
    collab_revision: 7,
    updated_at: "2026-07-22T00:00:00.000Z",
  };
  const staleContext = {
    ...context,
    supabase: {
      async rpc(name: string) {
        calls.push(name);
        if (name === "mcp_begin_operation") {
          return {
            data: [{
              operation_id: "00000000-0000-4000-8000-000000000006",
              remaining: 29,
              reset_at: new Date(Date.now() + 60_000).toISOString(),
            }],
            error: null,
          };
        }
        if (name === "mcp_read_document_transport_state") {
          return { data: { status: "ok", head, tail: [] }, error: null };
        }
        return { data: null, error: null };
      },
    },
  } as unknown as McpRequestContext;
  const message = await rpc("tools/call", {
    name: "update_document",
    arguments: {
      documentId: head.id,
      markdown: "# Replacement",
      stateToken: { epoch: 3, revision: 6, updateIds: [] },
    },
  }, staleContext);
  assertEquals(message.error, undefined);
  assertEquals(message.result?.isError, true);
  assertMatch(JSON.stringify(message.result), /DOCUMENT_CONFLICT/);
  assertEquals(calls, [
    "mcp_begin_operation",
    "mcp_read_document_transport_state",
    "mcp_complete_operation",
  ]);
});

Deno.test("rate-limited probe returns a stable tool error", async () => {
  const rateLimited = {
    ...context,
    supabase: {
      rpc(name: string) {
        if (name === "mcp_begin_operation") {
          return Promise.resolve({
            data: [{
              operation_id: "00000000-0000-4000-8000-000000000003",
              remaining: -1,
              reset_at: new Date(Date.now() + 10_000).toISOString(),
            }],
            error: null,
          });
        }
        throw new Error("Completion must not run for rejected admission.");
      },
    },
  } as unknown as McpRequestContext;
  const message = await rpc("tools/call", {
    name: "keco_connection_probe",
    arguments: {},
  }, rateLimited);
  assertEquals(message.error, undefined);
  assertEquals(message.result?.isError, true);
  assertEquals(
    (message.result?.structuredContent as Record<string, unknown>).ok,
    false,
  );
  assertMatch(JSON.stringify(message.result), /RATE_LIMITED/);
});

Deno.test("tools/call returns a bounded static result", async () => {
  const message = await rpc("tools/call", {
    name: "keco_connection_probe",
    arguments: {},
  });
  assertEquals(message.error, undefined);
  assertEquals(message.result, {
    content: [{ type: "text", text: "Keco MCP connection is operational." }],
    structuredContent: { ok: true, phase: 2 },
  });
});

Deno.test("protocol wrapper audits exact and oversized 1 MiB responses as one failed completion", async () => {
  const request = () => new Request("http://localhost/mcp/project", {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 41,
      method: "tools/call",
      params: { name: "keco_connection_probe", arguments: {} },
    }),
  });
  const originalLog = console.log;
  const logLines: string[] = [];
  console.log = (value) => logLines.push(String(value));
  try {
    for (const responseBytes of [1024 * 1024, 1024 * 1024 + 1]) {
      const calls: Array<{ name: string; parameters: Record<string, unknown> }> = [];
      const auditedContext = {
        ...context,
        requestId: crypto.randomUUID(),
        supabase: {
          async rpc(name: string, parameters: Record<string, unknown>) {
            calls.push({ name, parameters });
            if (name === "mcp_begin_operation") {
              return { data: [{
                operation_id: crypto.randomUUID(),
                remaining: 239,
                reset_at: new Date(Date.now() + 60_000).toISOString(),
              }], error: null };
            }
            return { data: null, error: null };
          },
        },
      } as unknown as McpRequestContext;

      const response = await handleProtocolRequest(
        request(),
        auditedContext,
        { handleTransport: async () => new Response(new Uint8Array(responseBytes)) },
      );
      const body = await response.json() as Record<string, unknown>;
      assertEquals(response.status, 200);
      assertEquals((await new Response(JSON.stringify(body)).arrayBuffer()).byteLength < 1024 * 1024, true);
      assertMatch(JSON.stringify(body), /PAYLOAD_TOO_LARGE/);
      assertEquals(calls.map((call) => call.name), [
        "mcp_begin_operation",
        "mcp_complete_operation",
      ]);
      assertEquals(calls[1].parameters.p_outcome, "failed");
      assertEquals(calls[1].parameters.p_error_code, "PAYLOAD_TOO_LARGE");
      assertEquals(calls[1].parameters.p_response_bytes, null);
    }
    assertEquals(logLines.length, 2);
    for (const line of logLines) {
      assertMatch(line, /"outcome":"failed"/);
      assertMatch(line, /"errorCode":"PAYLOAD_TOO_LARGE"/);
    }
  } finally {
    console.log = originalLog;
  }
});
