import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  extractBoundProjectId,
  extractMcpEndpoint,
  handleMcpHttpRequest,
} from "./http.ts";
import type { AccountAuthorization, ProjectAuthorization } from "./auth.ts";
import type { McpRequestContext } from "./context.ts";

const projectId = "11111111-1111-4111-8111-111111111111";
const allow = async (): Promise<ProjectAuthorization> => ({
  status: "authorized",
  context: {
    userId: "user-1",
    projectId,
    role: "editor",
    clientId: null,
    bearerToken: "valid",
  },
});
const unauthenticated = async (): Promise<ProjectAuthorization> => ({
  status: "unauthenticated",
});
const forbidden = async (): Promise<ProjectAuthorization> => ({
  status: "forbidden",
});
const operationalError = async (): Promise<ProjectAuthorization> => ({
  status: "operational_error",
});
const accountAllow = async (): Promise<AccountAuthorization> => ({
  status: "authorized",
  context: {
    userId: "user-1",
    clientId: "oauth-client",
    sessionId: "22222222-2222-4222-8222-222222222222",
    bearerToken: "valid-account",
  },
});
const accountUnauthenticated = async (): Promise<AccountAuthorization> => ({
  status: "unauthenticated",
});

function authorizedRequest(): Request {
  return new Request(`https://x/functions/v1/mcp/${projectId}`, {
    method: "POST",
    headers: { authorization: "Bearer valid" },
  });
}

const testContext = {
  requestId: "00000000-0000-4000-8000-000000000001",
  userId: "user-1",
  projectId,
  role: "editor",
  clientId: null,
  bearerToken: "valid",
  supabase: {
    rpc(name: string) {
      if (name === "mcp_begin_operation") return Promise.resolve({ data: [{
        operation_id: "00000000-0000-4000-8000-000000000002", remaining: 239,
        reset_at: new Date(Date.now() + 60_000).toISOString(),
      }], error: null });
      return Promise.resolve({ data: null, error: null });
    },
  },
} as unknown as McpRequestContext;

const withContext = {
  createContext: () => testContext,
};

Deno.test("extractBoundProjectId accepts only a UUID after the mcp segment", () => {
  assertEquals(
    extractBoundProjectId(new URL(`https://x/functions/v1/mcp/${projectId}`)),
    projectId,
  );
  assertEquals(
    extractBoundProjectId(new URL(`https://x/mcp/${projectId}`)),
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
  assertEquals(
    extractBoundProjectId(new URL(`https://x/api/mcp/${projectId}`)),
    null,
  );
  assertEquals(
    extractBoundProjectId(new URL(`https://x/prefix/functions/v1/mcp/${projectId}`)),
    null,
  );
});

Deno.test("extractMcpEndpoint recognizes only exact account and project routes", () => {
  assertEquals(
    extractMcpEndpoint(new URL("https://x/functions/v1/mcp")),
    { mode: "account" },
  );
  assertEquals(
    extractMcpEndpoint(new URL("https://x/mcp")),
    { mode: "account" },
  );
  assertEquals(
    extractMcpEndpoint(new URL(`https://x/mcp/${projectId}`)),
    { mode: "project", projectId },
  );
  for (const url of [
    "https://x/mcp/",
    "https://x/mcp/not-a-uuid",
    `https://x/mcp/${projectId}/extra`,
    "https://x/mcp?replay=1",
    "https://x/mcp?",
    "https://x/mcp#",
    "https://x/mcp?#",
    "https://x/functions/v1/mcp?",
    "https://x/functions/v1/mcp#",
    "https://x/functions/v1/mcp?#",
    `https://x/mcp/${projectId}?`,
    `https://x/mcp/${projectId}#`,
    `https://x/mcp/${projectId}?#`,
    `https://x/functions/v1/mcp/${projectId}?`,
    `https://x/functions/v1/mcp/${projectId}#`,
    `https://x/functions/v1/mcp/${projectId}?#`,
    "https://user:password@x/mcp",
    "https://x/mcp#fragment",
  ]) {
    assertEquals(extractMcpEndpoint(new URL(url)), null);
  }
});

Deno.test("account authentication uses the service metadata without a project query", async () => {
  const response = await handleMcpHttpRequest(
    new Request("https://x/functions/v1/mcp", { method: "POST" }),
    {
      authorizeAccount: accountUnauthenticated,
      authorizeProject: async () => {
        throw new Error("project authorization must not run for account route");
      },
      kecoPublicUrl: "https://keco.example.com",
    },
  );
  assertEquals(response.status, 401);
  assertEquals(
    response.headers.get("www-authenticate"),
    "Bearer resource_metadata=\"https://keco.example.com/api/mcp/oauth-protected-resource\"",
  );
});

Deno.test("account and project routes keep authorization dependencies isolated", async () => {
  const account = await handleMcpHttpRequest(
    new Request("https://x/mcp", { method: "POST" }),
    {
      ...withContext,
      authorizeAccount: accountAllow,
      authorizeProject: async () => {
        throw new Error("project token replayed to account route");
      },
      handleProtocol: async () => new Response("account"),
    },
  );
  const project = await handleMcpHttpRequest(authorizedRequest(), {
    ...withContext,
    authorizeAccount: async () => {
      throw new Error("account token replayed to project route");
    },
    authorizeProject: allow,
    handleProtocol: async () => new Response("project"),
  });

  assertEquals(account.status, 200);
  assertEquals(await account.text(), "account");
  assertEquals(project.status, 200);
  assertEquals(await project.text(), "project");
});

Deno.test("missing auth returns an OAuth resource metadata challenge", async () => {
  const response = await handleMcpHttpRequest(
    new Request(`https://x/functions/v1/mcp/${projectId}`, { method: "POST" }),
    { authorize: unauthenticated, kecoPublicUrl: "https://keco.example.com" },
  );
  assertEquals(response.status, 401);
  assertStringIncludes(
    response.headers.get("www-authenticate") ?? "",
    `resource_metadata="https://keco.example.com/api/mcp/oauth-protected-resource?project_id=${projectId}"`,
  );
});

Deno.test("invalid bearer token returns an OAuth challenge", async () => {
  const response = await handleMcpHttpRequest(
    new Request(`https://x/functions/v1/mcp/${projectId}`, {
      method: "POST",
      headers: { authorization: "Bearer invalid" },
    }),
    { authorize: unauthenticated, kecoPublicUrl: "https://keco.example.com" },
  );
  assertEquals(response.status, 401);
  assertStringIncludes(response.headers.get("www-authenticate") ?? "", "resource_metadata=");
});

Deno.test("revoked membership returns 403 without an OAuth challenge", async () => {
  const response = await handleMcpHttpRequest(
    new Request(`https://x/functions/v1/mcp/${projectId}`, {
      method: "POST",
      headers: { authorization: "Bearer valid" },
    }),
    { authorize: forbidden, kecoPublicUrl: "https://keco.example.com" },
  );
  assertEquals(response.status, 403);
  assertEquals(response.headers.get("www-authenticate"), null);
});

Deno.test("authorization backend failures return a safe CORS-wrapped 503", async () => {
  const response = await handleMcpHttpRequest(authorizedRequest(), {
    authorize: operationalError,
  });
  assertEquals(response.status, 503);
  assertEquals(await response.json(), { error: "MCP authorization is unavailable." });
  assertEquals(response.headers.get("www-authenticate"), null);
  assertEquals(response.headers.get("access-control-allow-origin"), "*");
});

Deno.test("missing or malformed public origin fails closed without a challenge", async () => {
  for (const kecoPublicUrl of ["", "/relative", "https://keco.example.com/path"]) {
    const response = await handleMcpHttpRequest(
      new Request(`https://x/functions/v1/mcp/${projectId}`, { method: "POST" }),
      { authorize: unauthenticated, kecoPublicUrl },
    );
    assertEquals(response.status, 500);
    assertEquals(response.headers.get("www-authenticate"), null);
  }
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
    { ...withContext, authorize: allow, kecoPublicUrl: "https://keco.example.com" },
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
    { ...withContext, authorize: allow, kecoPublicUrl: "https://keco.example.com" },
  );
  assertEquals(response.status, 413);
});

Deno.test("request is rejected at the strict 256 KiB boundary", async () => {
  const response = await handleMcpHttpRequest(
    new Request("https://x/functions/v1/mcp/" + projectId, {
      method: "POST",
      headers: {
        authorization: "Bearer valid",
        "content-length": String(256 * 1024),
      },
      body: "x",
    }),
    { ...withContext, authorize: allow },
  );
  assertEquals(response.status, 413);
});

Deno.test("OPTIONS returns bounded CORS headers without authentication", async () => {
  const response = await handleMcpHttpRequest(
    new Request(`https://x/functions/v1/mcp/${projectId}`, {
      method: "OPTIONS",
    }),
    { authorize: unauthenticated, kecoPublicUrl: "https://keco.example.com" },
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

Deno.test("rejects an oversized streamed protocol response and preserves CORS", async () => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(1024 * 1024));
      controller.enqueue(new Uint8Array(1));
      controller.close();
    },
  });
  const response = await handleMcpHttpRequest(
    new Request(`https://x/functions/v1/mcp/${projectId}`, {
      method: "POST",
      headers: { authorization: "Bearer valid" },
    }),
    {
      ...withContext,
      authorize: allow,
      kecoPublicUrl: "https://keco.example.com",
      handleProtocol: async () => new Response(body, {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    },
  );
  assertEquals(response.status, 502);
  assertEquals(await response.json(), {
    error: "MCP response must remain below 1 MiB.",
  });
  assertEquals(response.headers.get("access-control-allow-origin"), "*");
});

Deno.test("rejects a protocol response exactly at the strict 1 MiB boundary", async () => {
  const response = await handleMcpHttpRequest(
    new Request(`https://x/functions/v1/mcp/${projectId}`, {
      method: "POST",
      headers: { authorization: "Bearer valid" },
    }),
    {
      ...withContext,
      authorize: allow,
      kecoPublicUrl: "https://keco.example.com",
      handleProtocol: async () => new Response(new Uint8Array(1024 * 1024)),
    },
  );
  assertEquals(response.status, 502);
  assertEquals(await response.json(), {
    error: "MCP response must remain below 1 MiB.",
  });
});

Deno.test("rejects an explicit Content-Length at the strict 1 MiB boundary", async () => {
  const response = await handleMcpHttpRequest(authorizedRequest(), {
    ...withContext,
    authorize: allow,
    handleProtocol: async () => new Response("small body", {
      headers: { "content-length": String(1024 * 1024) },
    }),
  });
  assertEquals(response.status, 502);
  assertEquals((await response.arrayBuffer()).byteLength < 1024 * 1024, true);
});

Deno.test("accepts the largest streamed protocol response below 1 MiB", async () => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(1024 * 1024 - 1));
      controller.close();
    },
  });
  const response = await handleMcpHttpRequest(authorizedRequest(), {
    ...withContext,
    authorize: allow,
    handleProtocol: async () => new Response(body),
  });
  assertEquals(response.status, 200);
  assertEquals((await response.arrayBuffer()).byteLength, 1024 * 1024 - 1);
});

Deno.test("rejects a streamed protocol response exactly at 1 MiB", async () => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(1024 * 1024 - 1));
      controller.enqueue(new Uint8Array(1));
      controller.close();
    },
  });
  const response = await handleMcpHttpRequest(authorizedRequest(), {
    ...withContext,
    authorize: allow,
    handleProtocol: async () => new Response(body),
  });
  assertEquals(response.status, 502);
  assertEquals((await response.arrayBuffer()).byteLength < 1024 * 1024, true);
});

Deno.test("contains a rejecting declared-body cancellation", async () => {
  const body = new ReadableStream<Uint8Array>({
    cancel() {
      return Promise.reject(new Error("cancel failed"));
    },
  });
  const response = await handleMcpHttpRequest(authorizedRequest(), {
    ...withContext,
    authorize: allow,
    handleProtocol: async () => new Response(body, {
      headers: { "content-length": String(1024 * 1024) },
    }),
  });
  assertEquals(response.status, 502);
  assertEquals((await response.arrayBuffer()).byteLength < 1024 * 1024, true);
});

Deno.test("contains a rejecting streamed-body cancellation", async () => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(1024 * 1024));
    },
    cancel() {
      return Promise.reject(new Error("cancel failed"));
    },
  });
  const response = await handleMcpHttpRequest(authorizedRequest(), {
    ...withContext,
    authorize: allow,
    handleProtocol: async () => new Response(body),
  });
  assertEquals(response.status, 502);
  assertEquals((await response.arrayBuffer()).byteLength < 1024 * 1024, true);
});

Deno.test("contains streamed protocol response read errors", async () => {
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.error(new Error("read failed"));
    },
  });
  const response = await handleMcpHttpRequest(authorizedRequest(), {
    ...withContext,
    authorize: allow,
    handleProtocol: async () => new Response(body),
  });
  assertEquals(response.status, 502);
  assertEquals((await response.arrayBuffer()).byteLength < 1024 * 1024, true);
});

Deno.test("authorized initialize traverses body reconstruction, auth, CORS, and MCP transport", async () => {
  const response = await handleMcpHttpRequest(
    new Request(`https://x/functions/v1/mcp/${projectId}`, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        authorization: "Bearer valid",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "http-boundary-test", version: "1" },
        },
      }),
    }),
    { ...withContext, authorize: allow, kecoPublicUrl: "https://keco.example.com" },
  );
  assertEquals(response.status, 200);
  assertEquals(response.headers.get("access-control-allow-origin"), "*");
  const message = await response.json() as { result?: { serverInfo?: { name?: string } } };
  assertEquals(message.result?.serverInfo?.name, "keco-mcp");
});
