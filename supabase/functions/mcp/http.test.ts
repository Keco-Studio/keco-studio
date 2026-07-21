import { assertEquals, assertStringIncludes } from "@std/assert";
import { extractBoundProjectId, handleMcpHttpRequest } from "./http.ts";

const projectId = "11111111-1111-4111-8111-111111111111";
const allow = async () => ({
  userId: "user-1",
  projectId,
  role: "editor" as const,
});
const deny = async () => null;

Deno.test("extractBoundProjectId accepts only a UUID after the mcp segment", () => {
  assertEquals(
    extractBoundProjectId(new URL(`https://x/functions/v1/mcp/${projectId}`)),
    projectId,
  );
  assertEquals(
    extractBoundProjectId(new URL("https://x/functions/v1/mcp/not-a-uuid")),
    null,
  );
  assertEquals(
    extractBoundProjectId(
      new URL(`https://x/functions/v1/mcp/${projectId}/extra`),
    ),
    null,
  );
});

Deno.test("missing auth returns an OAuth resource metadata challenge", async () => {
  const response = await handleMcpHttpRequest(
    new Request(`https://x/functions/v1/mcp/${projectId}`, { method: "POST" }),
    { authorize: deny, kecoPublicUrl: "https://keco.example.com" },
  );
  assertEquals(response.status, 401);
  assertStringIncludes(
    response.headers.get("www-authenticate") ?? "",
    `resource_metadata="https://keco.example.com/api/mcp/oauth-protected-resource?project_id=${projectId}"`,
  );
});

Deno.test("oversized request is rejected before MCP parsing", async () => {
  const response = await handleMcpHttpRequest(
    new Request(
      `https://x/functions/v1/mcp/${projectId}`,
      {
        method: "POST",
        headers: { authorization: "Bearer valid", "content-length": "262145" },
        body: "x",
      },
    ),
    { authorize: allow, kecoPublicUrl: "https://keco.example.com" },
  );
  assertEquals(response.status, 413);
});

Deno.test("chunked request is rejected when the streamed body exceeds the limit", async () => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(256 * 1024));
      controller.enqueue(new Uint8Array(1));
      controller.close();
    },
  });
  const response = await handleMcpHttpRequest(
    new Request(
      `https://x/functions/v1/mcp/${projectId}`,
      {
        method: "POST",
        headers: {
          authorization: "Bearer valid",
          "content-type": "application/json",
        },
        body,
      },
    ),
    { authorize: allow, kecoPublicUrl: "https://keco.example.com" },
  );
  assertEquals(response.status, 413);
});

Deno.test("OPTIONS returns bounded CORS headers without authentication", async () => {
  const response = await handleMcpHttpRequest(
    new Request(`https://x/functions/v1/mcp/${projectId}`, {
      method: "OPTIONS",
    }),
    { authorize: deny, kecoPublicUrl: "https://keco.example.com" },
  );
  assertEquals(response.status, 204);
  assertEquals(
    response.headers.get("access-control-allow-methods"),
    "GET, POST, DELETE, OPTIONS",
  );
  assertStringIncludes(
    response.headers.get("access-control-allow-headers") ?? "",
    "MCP-Protocol-Version",
  );
});
