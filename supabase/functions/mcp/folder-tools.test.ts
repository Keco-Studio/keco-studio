import { assertEquals, assertMatch } from "@std/assert";
import type { ProjectMcpRequestContext } from "./context.ts";
import { handleProtocolRequest } from "./server.ts";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const PARENT_ID = "22222222-2222-4222-8222-222222222222";

type RpcCall = { name: string; parameters: Record<string, unknown> };

function folderContext(
  role: "admin" | "editor" | "viewer",
  calls: RpcCall[],
  folderError: { code: string; message: string } | null = null,
): ProjectMcpRequestContext {
  return {
    mode: "project",
    requestId: crypto.randomUUID(),
    userId: "user-1",
    projectId: PROJECT_ID,
    role,
    clientId: null,
    bearerToken: "test-token",
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
        if (name === "mcp_complete_operation") {
          return { data: null, error: null };
        }
        if (name === "mcp_create_folder") {
          return folderError ? { data: null, error: folderError } : {
            data: [{
              id: "33333333-3333-4333-8333-333333333333",
              project_id: PROJECT_ID,
              parent_folder_id: parameters.p_parent_folder_id,
              name: parameters.p_name,
              description: parameters.p_description,
              created_at: "2026-08-12T01:00:00.000Z",
              updated_at: "2026-08-12T01:00:00.000Z",
            }],
            error: null,
          };
        }
        throw new Error("Unexpected RPC: " + name);
      },
    },
  } as unknown as ProjectMcpRequestContext;
}

async function callFolder(context: ProjectMcpRequestContext) {
  const response = await handleProtocolRequest(
    new Request("http://localhost/mcp/project", {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "create_folder",
          arguments: {
            name: "  Art  ",
            description: "  Imported images  ",
            parentFolderId: PARENT_ID,
          },
        },
      }),
    }),
    context,
  );
  return await response.json();
}

Deno.test("create_folder calls one atomic RPC and returns a complete folder", async () => {
  const calls: RpcCall[] = [];
  const message = await callFolder(folderContext("admin", calls));

  assertEquals(message.result?.isError, undefined);
  assertEquals(message.result?.structuredContent, {
    ok: true,
    folder: {
      id: "33333333-3333-4333-8333-333333333333",
      projectId: PROJECT_ID,
      parentFolderId: PARENT_ID,
      name: "Art",
      description: "Imported images",
      createdAt: "2026-08-12T01:00:00.000Z",
      updatedAt: "2026-08-12T01:00:00.000Z",
    },
  });
  const mutations = calls.filter((call) => call.name === "mcp_create_folder");
  assertEquals(mutations.length, 1);
  assertEquals(mutations[0].parameters, {
    p_project_id: PROJECT_ID,
    p_name: "Art",
    p_description: "Imported images",
    p_parent_folder_id: PARENT_ID,
  });
});

for (const role of ["editor", "viewer"] as const) {
  Deno.test(`create_folder rejects ${role} without calling the mutation RPC`, async () => {
    const calls: RpcCall[] = [];
    const message = await callFolder(folderContext(role, calls));
    assertEquals(message.result?.isError, true);
    assertMatch(
      JSON.stringify(message.result),
      role === "viewer"
        ? /Tool create_folder not found/
        : /PROJECT_WRITE_FORBIDDEN/,
    );
    assertEquals(
      calls.some((call) => call.name === "mcp_create_folder"),
      false,
    );
  });
}

for (
  const [sqlState, publicCode] of [
    ["KF401", "PROJECT_WRITE_FORBIDDEN"],
    ["KF404", "FOLDER_NOT_FOUND"],
    ["KF409", "FOLDER_NAME_CONFLICT"],
    ["23514", "FIELD_VALIDATION_FAILED"],
  ] as const
) {
  Deno.test(`create_folder maps ${sqlState} to ${publicCode}`, async () => {
    const message = await callFolder(folderContext("admin", [], {
      code: sqlState,
      message: "private database detail",
    }));
    assertEquals(message.result?.isError, true);
    assertMatch(JSON.stringify(message.result), new RegExp(publicCode));
    assertEquals(
      JSON.stringify(message.result).includes("private database detail"),
      false,
    );
  });
}
