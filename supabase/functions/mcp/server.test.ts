import { assertEquals, assertMatch } from "@std/assert";
import { LATEST_PROTOCOL_VERSION } from "@mcp/types.js";
import { handleProtocolRequest } from "./server.ts";
import type { McpRequestContext, ProjectMcpRequestContext } from "./context.ts";

const PROJECT_READ_TOOL_NAMES = [
  "list_project_structure",
  "query_table_rows",
  "list_documents",
  "read_document",
  "read_story_graph",
  "semantic_search",
];

const PROJECT_WRITE_TOOL_NAMES = [
  "create_table",
  "add_table_field",
  "create_table_row",
  "update_table_row",
  "edit_table_field",
  "delete_table_field",
  "delete_table_row",
  "update_table",
  "reorder_table_fields",
  "delete_table",
  "bulk_update_table_rows",
  "upsert_table_rows",
  "create_document",
  "update_document",
  "create_image_upload",
  "complete_image_upload",
  "prepare_image_uploads",
  "complete_image_uploads",
  "create_folder",
];
const GDS_TOOL_NAMES = [
  "list_game_design_systems",
  "read_game_design_system",
  "read_project_game_design_system",
  "get_game_design_system_generation",
  "create_game_design_system",
  "generate_game_design_system",
  "create_game_design_system_version",
  "set_project_game_design_system",
  "clear_project_game_design_system",
];

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
    rpc(name: string) {
      if (name === "mcp_has_writable_project") {
        return Promise.resolve({ data: false, error: null });
      }
      if (name === "mcp_list_accessible_projects") {
        return Promise.resolve({ data: [], error: null });
      }
      if (name === "mcp_begin_account_operation") {
        return Promise.resolve({
          data: [{
            operation_id: "00000000-0000-4000-8000-000000000011",
            remaining: 239,
            reset_at: new Date(Date.now() + 60_000).toISOString(),
          }],
          error: null,
        });
      }
      if (name === "mcp_complete_operation") {
        return Promise.resolve({ data: null, error: null });
      }
      throw new Error("Unexpected account RPC: " + name);
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
  const tools = message.result?.tools as Array<{
    name: string;
    description: string;
    inputSchema: { properties?: Record<string, unknown> };
    annotations?: Record<string, boolean>;
  }>;
  const names = tools.map((tool) => tool.name);
  assertEquals(names, [
    "keco_connection_probe",
    ...PROJECT_READ_TOOL_NAMES,
    ...PROJECT_WRITE_TOOL_NAMES,
    ...GDS_TOOL_NAMES,
  ]);
  const addField = tools.find((tool) => tool.name === "add_table_field")!;
  assertEquals("projectId" in (addField.inputSchema.properties ?? {}), false);
  const storyGraph = tools.find((tool) => tool.name === "read_story_graph")!;
  assertEquals(Object.keys(storyGraph.inputSchema.properties ?? {}), [
    "libraryId",
    "limit",
    "cursor",
  ]);
  const createUpload = tools.find((tool) =>
    tool.name === "create_image_upload"
  )!;
  assertMatch(
    createUpload.description,
    /exact local file bytes[\s\S]*upload\.method[\s\S]*upload\.headers[\s\S]*image\.path[\s\S]*local path/i,
  );
  const completeUpload = tools.find((tool) =>
    tool.name === "complete_image_upload"
  )!;
  assertMatch(
    completeUpload.description,
    /complete verified image object[\s\S]*do not reduce it to a URL or path/i,
  );
  assertMatch(
    JSON.stringify(completeUpload.inputSchema),
    /image\.path[\s\S]*file: URI[\s\S]*signed upload URL/i,
  );
  for (
    const name of [
      "prepare_image_uploads",
      "complete_image_uploads",
      "create_folder",
    ]
  ) {
    const tool = tools.find((candidate) => candidate.name === name)!;
    assertEquals(tool.annotations, {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    });
  }
  for (
    const name of [
      "delete_table_field",
      "delete_table_row",
      "delete_table",
    ]
  ) {
    const tool = tools.find((candidate) => candidate.name === name) as {
      annotations?: { destructiveHint?: boolean };
    };
    assertEquals(tool.annotations?.destructiveHint, true);
  }
  for (
    const name of [
      "edit_table_field",
      "update_table",
      "reorder_table_fields",
      "bulk_update_table_rows",
      "upsert_table_rows",
    ]
  ) {
    const tool = tools.find((candidate) => candidate.name === name) as {
      annotations?: { destructiveHint?: boolean };
    };
    assertEquals(tool.annotations?.destructiveHint, false);
  }
});

Deno.test("viewer tools/list excludes project writes and retains owned GDS tools", async () => {
  const message = await rpc(
    "tools/list",
    {},
    { ...context, role: "viewer" } as McpRequestContext,
  );
  assertEquals(
    (message.result?.tools as Array<{ name: string }>).map((tool) => tool.name),
    [
      "keco_connection_probe",
      ...PROJECT_READ_TOOL_NAMES,
      ...GDS_TOOL_NAMES,
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

Deno.test("account mode exposes discovery and read tools with account telemetry", async () => {
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
    resources: { listChanged: false },
    prompts: { listChanged: true },
  });

  const tools = await rpc("tools/list", {}, accountContext);
  assertEquals(tools.error, undefined);
  assertEquals(
    (tools.result?.tools as Array<{ name: string }>).map((tool) => tool.name),
    [
      "keco_connection_probe",
      "list_projects",
      "list_project_structure",
      "query_table_rows",
      "list_documents",
      "read_document",
      "read_story_graph",
      "semantic_search",
      ...GDS_TOOL_NAMES,
    ],
  );

  const resources = await rpc("resources/list", {}, accountContext);
  assertEquals(resources.error, undefined);
  assertEquals(
    (resources.result?.resources as Array<{ uri: string }>).map((resource) =>
      resource.uri
    ),
    ["keco://projects"],
  );

  const templates = await rpc("resources/templates/list", {}, accountContext);
  assertEquals(templates.error, undefined);
  assertEquals((templates.result?.resourceTemplates as unknown[]).length, 5);

  const prompts = await rpc("prompts/list", {}, accountContext);
  assertEquals(prompts.error, undefined);
  assertEquals(
    (prompts.result?.prompts as Array<{ name: string }>).map((prompt) =>
      prompt.name
    ),
    ["analyze_project", "build_tables_from_document", "update_project_data"],
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

Deno.test("GDS tools use read and write telemetry classes", async () => {
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
              operation_id: "00000000-0000-4000-8000-000000000019",
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
  for (
    const [name, expectedClass] of [
      ["read_game_design_system", "read"],
      ["generate_game_design_system", "write"],
    ] as const
  ) {
    calls.length = 0;
    await handleProtocolRequest(
      new Request("http://localhost/mcp/project", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name, arguments: {} },
        }),
      }),
      audited,
      { handleTransport: async () => Response.json({ ok: true }) },
    );
    assertEquals(calls[0].parameters.p_operation, name);
    assertEquals(calls[0].parameters.p_operation_class, expectedClass);
  }
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

Deno.test("create_table accepts image fields and makes one primary atomic RPC", async () => {
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
      fields: [{ label: "Icon", dataType: "image" }],
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
  assertMatch(JSON.stringify(primary.p_fields), /"dataType":"image"/);
});

Deno.test("add_table_field calls one atomic RPC and rejects required fields", async () => {
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
        if (name === "mcp_add_table_field") {
          return { data: [{ field_id: parameters.p_field_id }], error: null };
        }
        return { data: null, error: null };
      },
    },
  } as unknown as McpRequestContext;
  const valid = await rpc("tools/call", {
    name: "add_table_field",
    arguments: {
      tableId: "22222222-2222-4222-8222-222222222222",
      field: { label: "Icon", dataType: "image" },
    },
  }, writeContext);
  assertEquals(valid.result?.isError, undefined);
  assertEquals(calls.map((call) => call.name), [
    "mcp_begin_operation",
    "mcp_add_table_field",
    "mcp_complete_operation",
  ]);
  assertEquals(calls[1].parameters?.p_project_id, context.projectId);
  assertEquals(
    calls[1].parameters?.p_table_id,
    "22222222-2222-4222-8222-222222222222",
  );
  assertMatch(String(calls[1].parameters?.p_field_id), /^[0-9a-f-]{36}$/);
  assertEquals(calls[1].parameters?.p_field, {
    label: "Icon",
    dataType: "image",
  });

  calls.length = 0;
  const required = await rpc("tools/call", {
    name: "add_table_field",
    arguments: {
      tableId: "22222222-2222-4222-8222-222222222222",
      field: { label: "Required", dataType: "string", required: true },
    },
  }, writeContext);
  assertEquals(required.result?.isError, true);
  assertMatch(JSON.stringify(required.result), /required/i);
  assertEquals(
    calls.some((call) => call.name === "mcp_add_table_field"),
    false,
  );
});

Deno.test("table maintenance tools call their atomic RPCs with public arguments", async () => {
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
              operation_id: "00000000-0000-4000-8000-000000000012",
              remaining: 29,
              reset_at: new Date(Date.now() + 60_000).toISOString(),
            }],
            error: null,
          };
        }
        if (name.startsWith("mcp_")) {
          return { data: [{ ok: true }], error: null };
        }
        return { data: null, error: null };
      },
    },
  } as unknown as McpRequestContext;
  const tableId = "22222222-2222-4222-8222-222222222222";
  const fieldId = "33333333-3333-4333-8333-333333333333";
  const rowId = "44444444-4444-4444-8444-444444444444";

  await rpc("tools/call", {
    name: "edit_table_field",
    arguments: {
      tableId,
      fieldId,
      field: { label: "Title", dataType: "string" },
      clearValuesOnTypeChange: true,
    },
  }, writeContext);
  await rpc("tools/call", {
    name: "delete_table_field",
    arguments: { tableId, fieldId, clearValues: true },
  }, writeContext);
  await rpc("tools/call", {
    name: "delete_table_row",
    arguments: { tableId, rowId, expectedRowId: rowId, clearReferences: true },
  }, writeContext);
  await rpc("tools/call", {
    name: "update_table",
    arguments: { tableId, name: "Renamed", folderId: null },
  }, writeContext);
  await rpc("tools/call", {
    name: "reorder_table_fields",
    arguments: {
      tableId,
      fields: [{ fieldId, section: "Main", sectionId: "section-main" }],
    },
  }, writeContext);
  await rpc("tools/call", {
    name: "delete_table",
    arguments: { tableId, confirmName: "Renamed", clearReferences: true },
  }, writeContext);
  await rpc("tools/call", {
    name: "bulk_update_table_rows",
    arguments: {
      tableId,
      rows: [
        { rowId, values: { Title: "A" } },
        { rowIndex: 2, values: { Title: "B" } },
      ],
    },
  }, writeContext);
  await rpc("tools/call", {
    name: "upsert_table_rows",
    arguments: {
      tableId,
      matchField: "Title",
      rows: [{ values: { Title: "A" } }],
      reuseEmpty: true,
    },
  }, writeContext);

  const primaryCalls = calls.filter((call) =>
    !["mcp_begin_operation", "mcp_complete_operation"].includes(call.name)
  );
  assertEquals(primaryCalls.map((call) => call.name), [
    "mcp_edit_table_field",
    "mcp_delete_table_field",
    "mcp_delete_table_row",
    "mcp_update_table",
    "mcp_reorder_table_fields",
    "mcp_delete_table",
    "mcp_bulk_update_table_rows",
    "mcp_upsert_table_rows",
  ]);
  assertEquals(primaryCalls[0].parameters?.p_clear_values_on_type_change, true);
  assertEquals(primaryCalls[1].parameters?.p_clear_values, true);
  assertEquals(primaryCalls[2].parameters?.p_clear_references, true);
  assertEquals(primaryCalls[2].parameters?.p_expected_row_id, rowId);
  assertEquals(primaryCalls[2].parameters?.p_row_index, null);
  assertEquals(primaryCalls[3].parameters?.p_set_folder, true);
  assertEquals(primaryCalls[3].parameters?.p_set_description, false);
  assertEquals(primaryCalls[4].parameters?.p_fields, [
    { fieldId, section: "Main", sectionId: "section-main" },
  ]);
  assertEquals(primaryCalls[5].parameters?.p_confirm_name, "Renamed");
  assertEquals(primaryCalls[6].parameters?.p_rows, [
    { rowId, values: { Title: "A" } },
    { rowIndex: 2, values: { Title: "B" } },
  ]);
  assertEquals(primaryCalls[7].parameters?.p_match_field, "Title");
  assertEquals(primaryCalls[7].parameters?.p_reuse_empty, true);
});

Deno.test("bulk and upsert table row writes schedule row reindexing from RPC row IDs", async () => {
  const originalUrl = Deno.env.get("KECO_PUBLIC_URL");
  const originalSecret = Deno.env.get("MCP_CODEC_SECRET");
  const globalForTest = globalThis as unknown as {
    EdgeRuntime?: { waitUntil(promise: Promise<unknown>): void };
    fetch: typeof fetch;
  };
  const originalEdgeRuntime = globalForTest.EdgeRuntime;
  const originalFetch = globalForTest.fetch;
  const waits: Promise<unknown>[] = [];
  const requests: unknown[] = [];
  Deno.env.set("KECO_PUBLIC_URL", "https://keco.test");
  Deno.env.set("MCP_CODEC_SECRET", "reindex-test-secret");
  globalForTest.EdgeRuntime = {
    waitUntil(promise) {
      waits.push(promise);
    },
  };
  globalForTest.fetch = ((_url: string | URL | Request, init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body)));
    return Promise.resolve(new Response(null, { status: 204 }));
  }) as typeof fetch;

  try {
    const tableId = "22222222-2222-4222-8222-222222222222";
    const rowA = "44444444-4444-4444-8444-444444444444";
    const rowB = "55555555-5555-4555-8555-555555555555";
    const rowC = "66666666-6666-4666-8666-666666666666";
    const actorId = "77777777-7777-4777-8777-777777777777";
    const writeContext = {
      ...context,
      userId: actorId,
      supabase: {
        async rpc(name: string) {
          if (name === "mcp_begin_operation") {
            return {
              data: [{
                operation_id: "00000000-0000-4000-8000-000000000012",
                remaining: 29,
                reset_at: new Date(Date.now() + 60_000).toISOString(),
              }],
              error: null,
            };
          }
          if (name === "mcp_bulk_update_table_rows") {
            return { data: [{ row_ids: [rowA, rowB] }], error: null };
          }
          if (name === "mcp_upsert_table_rows") {
            return { data: [{ row_ids: [rowC] }], error: null };
          }
          return { data: null, error: null };
        },
      },
    } as unknown as McpRequestContext;

    await rpc("tools/call", {
      name: "bulk_update_table_rows",
      arguments: { tableId, rows: [{ rowId: rowA, values: { Title: "A" } }] },
    }, writeContext);
    await rpc("tools/call", {
      name: "upsert_table_rows",
      arguments: {
        tableId,
        matchField: "Title",
        rows: [{ values: { Title: "B" } }],
      },
    }, writeContext);
    await Promise.all(waits);

    assertEquals(requests, [
      {
        kind: "row",
        projectId: context.projectId,
        actorUserId: actorId,
        rowId: rowA,
      },
      {
        kind: "row",
        projectId: context.projectId,
        actorUserId: actorId,
        rowId: rowB,
      },
      {
        kind: "row",
        projectId: context.projectId,
        actorUserId: actorId,
        rowId: rowC,
      },
    ]);
  } finally {
    if (originalUrl === undefined) Deno.env.delete("KECO_PUBLIC_URL");
    else Deno.env.set("KECO_PUBLIC_URL", originalUrl);
    if (originalSecret === undefined) Deno.env.delete("MCP_CODEC_SECRET");
    else Deno.env.set("MCP_CODEC_SECRET", originalSecret);
    globalForTest.EdgeRuntime = originalEdgeRuntime;
    globalForTest.fetch = originalFetch;
  }
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
  const request = () =>
    new Request("http://localhost/mcp/project", {
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
      const calls: Array<
        { name: string; parameters: Record<string, unknown> }
      > = [];
      const auditedContext = {
        ...context,
        requestId: crypto.randomUUID(),
        supabase: {
          async rpc(name: string, parameters: Record<string, unknown>) {
            calls.push({ name, parameters });
            if (name === "mcp_begin_operation") {
              return {
                data: [{
                  operation_id: crypto.randomUUID(),
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

      const response = await handleProtocolRequest(
        request(),
        auditedContext,
        {
          handleTransport: async () =>
            new Response(new Uint8Array(responseBytes)),
        },
      );
      const body = await response.json() as Record<string, unknown>;
      assertEquals(response.status, 200);
      assertEquals(
        (await new Response(JSON.stringify(body)).arrayBuffer()).byteLength <
          1024 * 1024,
        true,
      );
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
