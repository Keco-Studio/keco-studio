import { assertEquals, assertMatch } from "@std/assert";
import type { AccountMcpRequestContext } from "./context.ts";
import { handleProtocolRequest } from "./server.ts";

const WRITABLE_PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const VIEWER_PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const STORY_LIBRARY_ID = "33333333-3333-4333-8333-333333333333";
Deno.env.set("MCP_CURSOR_SECRET", "account-tools-story-graph-secret");
const ACCOUNT_WRITE_TOOL_NAMES = [
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
  "get_project_gdd_generation",
  "create_game_design_system",
  "generate_game_design_system",
  "create_game_design_system_version",
  "set_project_game_design_system",
  "clear_project_game_design_system",
  "generate_project_gdd",
  "cancel_project_gdd_generation",
];
const MAP_TOOL_NAMES = [
  "list_maps",
  "read_map",
  "create_map_draft",
  "update_map_draft",
  "prepare_map_generation",
  "start_map_generation",
  "get_map_generation",
  "advance_map_generation",
];

type RpcCall = { name: string; parameters: Record<string, unknown> };
type StorageCall = { name: string; arguments: unknown[] };

function pngBytes(size = 68): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return bytes;
}

function accountContext(
  calls: RpcCall[],
  options: {
    writable?: boolean;
    resolvedRole?: "admin" | "editor" | "viewer";
    failWritableDiscovery?: boolean;
    delayProjectReadMs?: number;
    resolvedRoles?: Array<"admin" | "editor" | "viewer">;
  } = {},
  storageCalls: StorageCall[] = [],
): AccountMcpRequestContext {
  const writable = options.writable ?? true;
  let resolveCount = 0;
  const bucket = {
    async createSignedUploadUrl(...args: unknown[]) {
      storageCalls.push({ name: "createSignedUploadUrl", arguments: args });
      return {
        data: {
          signedUrl: "https://storage.example/upload?token=signed",
          path: args[0],
          token: "signed",
        },
        error: null,
      };
    },
    async info(...args: unknown[]) {
      storageCalls.push({ name: "info", arguments: args });
      return {
        data: {
          size: 68,
          contentType: "image/png",
          createdAt: "2026-07-30T08:00:00.000Z",
        },
        error: null,
      };
    },
    async download(...args: unknown[]) {
      storageCalls.push({ name: "download", arguments: args });
      const bytes = pngBytes();
      return {
        data: new Blob([
          bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          ) as ArrayBuffer,
        ]),
        error: null,
      };
    },
    getPublicUrl(path: string) {
      storageCalls.push({ name: "getPublicUrl", arguments: [path] });
      return {
        data: {
          publicUrl:
            `https://storage.example/object/public/library-media-files/${path}`,
        },
      };
    },
  };
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
          const role = options.resolvedRoles?.[resolveCount++] ??
            options.resolvedRole ?? "editor";
          return { data: role, error: null };
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
        if (name === "mcp_read_story_graph_snapshot") {
          const field = (
            suffix: number,
            label: string,
            orderIndex: number,
          ) => ({
            id: `50000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`,
            label,
            dataType: "string",
            orderIndex,
          });
          const fields = [
            field(1, "Label", 0),
            field(2, "Type", 1),
            field(3, "Name", 2),
            field(4, "Content", 3),
            field(5, "Commands", 4),
          ];
          return {
            data: {
              status: "ok",
              library: {
                id: STORY_LIBRARY_ID,
                name: "Story",
                documentExportType: "script",
                updatedAt: "2026-08-06T00:00:00.000Z",
                plotPlan: {
                  version: 2,
                  entryPlotNodeId: "OnlyPlot",
                  storyNodeOrder: ["OnlyNode"],
                  nodes: [{
                    id: "OnlyPlot",
                    title: "Only plot",
                    storyNodeIds: ["OnlyNode"],
                  }],
                  edges: [],
                },
              },
              fields,
              rows: [{
                id: "60000000-0000-4000-8000-000000000001",
                name: "OnlyNode",
                rowIndex: 0,
                createdAt: "2026-08-06T00:00:00.000Z",
                updatedAt: "2026-08-06T00:00:00.000Z",
                values: [
                  { fieldId: fields[0].id, value: "OnlyNode" },
                  { fieldId: fields[1].id, value: "3" },
                  { fieldId: fields[2].id, value: "" },
                  { fieldId: fields[3].id, value: "Done." },
                  { fieldId: fields[4].id, value: "End" },
                ],
              }],
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
        if (name === "mcp_create_folder") {
          return {
            data: [{
              id: "44444444-4444-4444-8444-444444444444",
              project_id: parameters.p_project_id,
              parent_folder_id: parameters.p_parent_folder_id,
              name: parameters.p_name,
              description: parameters.p_description,
              created_at: "2026-08-12T01:00:00.000Z",
              updated_at: "2026-08-12T01:00:00.000Z",
            }],
            error: null,
          };
        }
        if (name === "mcp_add_table_field") {
          return { data: [{ field_id: parameters.p_field_id }], error: null };
        }
        if (
          [
            "mcp_edit_table_field",
            "mcp_delete_table_field",
            "mcp_delete_table_row",
            "mcp_update_table",
            "mcp_reorder_table_fields",
            "mcp_delete_table",
            "mcp_bulk_update_table_rows",
            "mcp_upsert_table_rows",
          ].includes(name)
        ) {
          return { data: [{ ok: true }], error: null };
        }
        throw new Error("Unexpected RPC: " + name);
      },
      storage: {
        from(name: string) {
          storageCalls.push({ name: "from", arguments: [name] });
          return bucket;
        },
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
    "read_story_graph",
    "semantic_search",
    "export_slice_mirrors",
    ...ACCOUNT_WRITE_TOOL_NAMES,
    "create_slice_bundle",
    "checkpoint_slice",
    "finalize_slice",
    ...GDS_TOOL_NAMES,
    ...MAP_TOOL_NAMES,
  ]);
  const listProjects = tools.find((tool) => tool.name === "list_projects")!;
  assertEquals(Object.keys(listProjects.inputSchema.properties ?? {}), [
    "limit",
    "cursor",
  ]);
  assertEquals(listProjects.inputSchema.required, undefined);
  const projectTools = tools.filter((tool) =>
    ![
      "keco_connection_probe",
      "list_projects",
      "list_game_design_systems",
      "read_game_design_system",
      "get_game_design_system_generation",
      "create_game_design_system",
      "generate_game_design_system",
      "create_game_design_system_version",
    ].includes(tool.name)
  );
  for (const tool of projectTools) {
    assertEquals(tool.inputSchema.required?.includes("projectId"), true);
  }
  const addField = tools.find((tool) => tool.name === "add_table_field")!;
  assertEquals(addField.inputSchema.required, [
    "projectId",
    "tableId",
    "field",
  ]);
  assertEquals(calls[0].name, "mcp_begin_account_operation");
  assertEquals(calls[1].name, "mcp_has_writable_project");
  assertEquals(calls[1].parameters, undefined);
});

Deno.test("account story graph read resolves live access before its snapshot", async () => {
  const calls: RpcCall[] = [];
  const message = await rpc(accountContext(calls), "tools/call", {
    name: "read_story_graph",
    arguments: {
      projectId: WRITABLE_PROJECT_ID,
      libraryId: STORY_LIBRARY_ID,
      limit: 200,
    },
  });

  assertEquals(message.error, undefined);
  assertEquals(
    message.result?.isError,
    undefined,
    JSON.stringify(message.result),
  );
  assertEquals(
    calls.filter((call) =>
      [
        "mcp_resolve_project_role",
        "mcp_read_story_graph_snapshot",
      ].includes(call.name)
    ).map((call) => call.name),
    ["mcp_resolve_project_role", "mcp_read_story_graph_snapshot"],
  );
  const admission = calls.find((call) =>
    call.name === "mcp_begin_account_operation"
  )!;
  assertEquals(admission.parameters.p_operation, "read_story_graph");
  assertEquals(admission.parameters.p_operation_class, "read");
});

Deno.test("account add_table_field resolves live access and calls the atomic RPC", async () => {
  const calls: RpcCall[] = [];
  const message = await rpc(accountContext(calls), "tools/call", {
    name: "add_table_field",
    arguments: {
      projectId: WRITABLE_PROJECT_ID,
      tableId: "33333333-3333-4333-8333-333333333333",
      field: { label: "Icon", dataType: "image" },
    },
  });
  assertEquals(message.error, undefined);
  assertEquals(message.result?.isError, undefined);
  const call = calls.find((candidate) =>
    candidate.name === "mcp_add_table_field"
  )!;
  assertEquals(call.parameters.p_project_id, WRITABLE_PROJECT_ID);
  assertEquals(
    call.parameters.p_table_id,
    "33333333-3333-4333-8333-333333333333",
  );
  assertMatch(String(call.parameters.p_field_id), /^[0-9a-f-]{36}$/);
  assertEquals(call.parameters.p_field, {
    label: "Icon",
    dataType: "image",
  });
  assertEquals(
    calls.filter((candidate) => candidate.name === "mcp_resolve_project_role")
      .length,
    1,
  );
});

Deno.test("account delete_table_field requires projectId and resolves live access", async () => {
  const calls: RpcCall[] = [];
  const fieldId = "33333333-3333-4333-8333-333333333333";
  const tableId = "44444444-4444-4444-8444-444444444444";
  const missingProject = await rpc(accountContext(calls), "tools/call", {
    name: "delete_table_field",
    arguments: { tableId, fieldId, clearValues: true },
  });
  assertEquals(missingProject.result?.isError, true);
  assertEquals(
    calls.some((candidate) => candidate.name === "mcp_delete_table_field"),
    false,
  );

  const message = await rpc(accountContext(calls), "tools/call", {
    name: "delete_table_field",
    arguments: {
      projectId: WRITABLE_PROJECT_ID,
      tableId,
      fieldId,
      clearValues: true,
    },
  });
  assertEquals(message.error, undefined);
  assertEquals(message.result?.isError, undefined);
  const call = calls.find((candidate) =>
    candidate.name === "mcp_delete_table_field"
  )!;
  assertEquals(call.parameters.p_project_id, WRITABLE_PROJECT_ID);
  assertEquals(call.parameters.p_table_id, tableId);
  assertEquals(call.parameters.p_field_id, fieldId);
  assertEquals(call.parameters.p_clear_values, true);
  assertEquals(
    calls.filter((candidate) => candidate.name === "mcp_resolve_project_role")
      .length,
    1,
  );
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

Deno.test("account create_folder allows admin and rejects editor after live resolution", async () => {
  const adminCalls: RpcCall[] = [];
  const admin = await rpc(
    accountContext(adminCalls, { resolvedRole: "admin" }),
    "tools/call",
    {
      name: "create_folder",
      arguments: { projectId: WRITABLE_PROJECT_ID, name: "Art" },
    },
  );
  assertEquals(admin.result?.isError, undefined);
  assertEquals(
    adminCalls.filter((call) => call.name === "mcp_create_folder").length,
    1,
  );

  const editorCalls: RpcCall[] = [];
  const editor = await rpc(
    accountContext(editorCalls, { resolvedRole: "editor" }),
    "tools/call",
    {
      name: "create_folder",
      arguments: { projectId: WRITABLE_PROJECT_ID, name: "Art" },
    },
  );
  assertEquals(editor.result?.isError, true);
  assertMatch(JSON.stringify(editor.result), /PROJECT_WRITE_FORBIDDEN/);
  assertEquals(
    editorCalls.some((call) => call.name === "mcp_create_folder"),
    false,
  );
});

Deno.test("account image upload phases resolve live write access independently", async () => {
  const calls: RpcCall[] = [];
  const storageCalls: StorageCall[] = [];
  const context = accountContext(
    calls,
    { resolvedRoles: ["editor", "viewer"] },
    storageCalls,
  );
  const prepared = await rpc(context, "tools/call", {
    name: "create_image_upload",
    arguments: {
      projectId: WRITABLE_PROJECT_ID,
      fileName: "hero.png",
      fileType: "image/png",
      fileSize: 68,
    },
  });
  assertEquals(prepared.result?.isError, undefined);
  const path = (prepared.result?.structuredContent as {
    image: { path: string };
  }).image.path;

  const completed = await rpc(context, "tools/call", {
    name: "complete_image_upload",
    arguments: { projectId: WRITABLE_PROJECT_ID, path },
  });
  assertEquals(completed.result?.isError, true);
  assertMatch(JSON.stringify(completed.result), /PROJECT_WRITE_FORBIDDEN/);
  assertEquals(
    calls.filter((call) => call.name === "mcp_resolve_project_role").length,
    2,
  );
  assertEquals(storageCalls.map((call) => call.name), [
    "from",
    "createSignedUploadUrl",
    "getPublicUrl",
  ]);
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
