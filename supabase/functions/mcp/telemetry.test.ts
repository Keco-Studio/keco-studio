import { assertEquals } from "@std/assert";
import type {
  AccountMcpRequestContext,
  ProjectMcpRequestContext,
} from "./context.ts";
import {
  measureMcpPhase,
  runMcpOperation,
  runMcpProtocolOperation,
} from "./telemetry.ts";

Deno.test("operation telemetry records actual bytes and logs only opaque identities", async () => {
  const originalLog = console.log;
  const lines: string[] = [];
  console.log = (value) => lines.push(String(value));
  const completions: Record<string, unknown>[] = [];
  const context = {
    requestId: "00000000-0000-4000-8000-000000000001",
    userId: "sensitive-user-id",
    projectId: "11111111-1111-4111-8111-111111111111",
    role: "viewer",
    clientId: null,
    supabase: {
      async rpc(name: string, parameters: Record<string, unknown>) {
        if (name === "mcp_begin_operation") {
          return {
            data: [{
              operation_id: "00000000-0000-4000-8000-000000000002",
              remaining: 119,
              reset_at: new Date(Date.now() + 60_000).toISOString(),
            }],
            error: null,
          };
        }
        completions.push(parameters);
        return { data: null, error: null };
      },
    },
  } as unknown as ProjectMcpRequestContext;
  try {
    const response = await runMcpOperation(context, "test_response", "read", {
      query: "raw secret query",
      token: "raw secret token",
    }, async () => {
      await measureMcpPhase(
        context,
        "database",
        () => new Promise((resolve) => setTimeout(resolve, 5)),
      );
      await measureMcpPhase(
        context,
        "embedding",
        () => new Promise((resolve) => setTimeout(resolve, 5)),
      );
      return new Response("12345");
    });
    assertEquals(await response.text(), "12345");
    assertEquals(completions[0].p_response_bytes, 5);
    assertEquals(Number(completions[0].p_database_ms) > 0, true);
    assertEquals(Number(completions[0].p_embedding_ms) > 0, true);
    assertEquals(lines.length, 1);
    const serialized = lines[0];
    assertEquals(serialized.includes("sensitive-user-id"), false);
    assertEquals(serialized.includes(context.projectId), false);
    assertEquals(serialized.includes("raw secret query"), false);
    assertEquals(serialized.includes("raw secret token"), false);
  } finally {
    console.log = originalLog;
  }
});

Deno.test("account protocol telemetry uses account admission without project identity", async () => {
  const originalLog = console.log;
  const lines: string[] = [];
  console.log = (value) => lines.push(String(value));
  const calls: Array<{ name: string; parameters: Record<string, unknown> }> =
    [];
  const context = {
    mode: "account",
    requestId: "00000000-0000-4000-8000-000000000010",
    userId: "sensitive-account-user",
    clientId: "account-client",
    sessionId: "00000000-0000-4000-8000-000000000011",
    supabase: {
      async rpc(name: string, parameters: Record<string, unknown>) {
        calls.push({ name, parameters });
        if (name === "mcp_begin_account_operation") {
          return {
            data: [{
              operation_id: "00000000-0000-4000-8000-000000000012",
              remaining: 119,
              reset_at: new Date(Date.now() + 60_000).toISOString(),
            }],
            error: null,
          };
        }
        return { data: null, error: null };
      },
    },
  } as unknown as AccountMcpRequestContext;
  try {
    const response = await runMcpProtocolOperation(
      context,
      { operation: "list_projects", operationClass: "read", requestBytes: 42 },
      async () => Response.json({ jsonrpc: "2.0", id: 1, result: {} }),
    );
    assertEquals(response.status, 200);
    assertEquals(calls.map((call) => call.name), [
      "mcp_begin_account_operation",
      "mcp_complete_operation",
    ]);
    assertEquals(calls[0].parameters, {
      p_operation: "list_projects",
      p_operation_class: "read",
      p_request_id: context.requestId,
      p_client_id: context.clientId,
      p_request_bytes: 42,
    });
    assertEquals(lines.length, 1);
    const event = JSON.parse(lines[0]) as Record<string, unknown>;
    assertEquals("projectHash" in event, false);
    assertEquals("role" in event, false);
    assertEquals(lines[0].includes(context.userId), false);
  } finally {
    console.log = originalLog;
  }
});
