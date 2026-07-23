import { assertEquals } from "@std/assert";
import type { ProjectMcpRequestContext } from "./context.ts";
import { measureMcpPhase, runMcpOperation } from "./telemetry.ts";

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
