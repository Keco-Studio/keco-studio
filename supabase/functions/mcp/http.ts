import { authorizeProject, type ProjectAuthorization } from "./auth.ts";
import { handleProtocolRequest } from "./server.ts";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_REQUEST_BYTES = 256 * 1024;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers":
    "Authorization, Content-Type, Accept, MCP-Protocol-Version, MCP-Session-Id, Last-Event-ID",
  "access-control-expose-headers":
    "MCP-Protocol-Version, MCP-Session-Id, WWW-Authenticate",
};

export function extractBoundProjectId(url: URL): string | null {
  const match = /^\/functions\/v1\/mcp\/([^/]+)$/.exec(url.pathname);
  return match && UUID.test(match[1]) ? match[1] : null;
}

export type McpHttpDependencies = {
  authorize?: (
    request: Request,
    projectId: string,
  ) => Promise<ProjectAuthorization>;
  kecoPublicUrl?: string;
  handleProtocol?: (request: Request) => Promise<Response>;
};

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  Object.entries(CORS).forEach(([key, value]) => headers.set(key, value));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function readBoundedBody(request: Request): Promise<Request | null> {
  if (!request.body) return request;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      if (total + value.byteLength > MAX_REQUEST_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body: total === 0 ? undefined : body,
  });
}

function tooLargeByContentLength(request: Request): boolean {
  const contentLength = request.headers.get("content-length");
  if (!contentLength) return false;
  const declaredLength = Number(contentLength);
  return Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES;
}

function normalizePublicOrigin(value: string | undefined): string | null {
  if (!value || value.trim() !== value) return null;
  try {
    const parsed = new URL(value);
    if (
      (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
      parsed.username ||
      parsed.password ||
      (parsed.pathname !== "" && parsed.pathname !== "/") ||
      parsed.search ||
      parsed.hash
    ) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

async function boundedProtocolResponse(response: Response): Promise<Response | null> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared >= MAX_RESPONSE_BYTES) {
    await cancelSafely(() => response.body?.cancel() ?? Promise.resolve());
    return null;
  }
  if (!response.body) return response;

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      if (total + value.byteLength >= MAX_RESPONSE_BYTES) {
        await cancelSafely(() => reader.cancel());
        return null;
      }
      total += value.byteLength;
      chunks.push(value);
    }
  } catch {
    await cancelSafely(() => reader.cancel());
    return null;
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

async function cancelSafely(cancel: () => Promise<void>): Promise<void> {
  try {
    await cancel();
  } catch {
    // The caller replaces the failed upstream response with a bounded response.
  }
}

export async function handleMcpHttpRequest(
  request: Request,
  deps: McpHttpDependencies = {},
): Promise<Response> {
  if (request.method === "OPTIONS") {
    return withCors(new Response(null, { status: 204 }));
  }
  const projectId = extractBoundProjectId(new URL(request.url));
  if (!projectId) {
    return withCors(
      Response.json({ error: "Invalid MCP project endpoint." }, {
        status: 404,
      }),
    );
  }
  if (tooLargeByContentLength(request)) {
    return withCors(
      Response.json({ error: "MCP request exceeds 256 KiB." }, { status: 413 }),
    );
  }
  let boundedRequest: Request | null;
  try {
    boundedRequest = await readBoundedBody(request);
  } catch {
    return withCors(
      Response.json({ error: "Unable to read MCP request body." }, {
        status: 400,
      }),
    );
  }
  if (!boundedRequest) {
    return withCors(
      Response.json({ error: "MCP request exceeds 256 KiB." }, { status: 413 }),
    );
  }
  const authorize = deps.authorize ?? authorizeProject;
  let authorization: ProjectAuthorization;
  try {
    authorization = await authorize(boundedRequest, projectId);
  } catch {
    authorization = { status: "operational_error" };
  }
  if (authorization.status === "operational_error") {
    return withCors(Response.json({ error: "MCP authorization is unavailable." }, {
      status: 503,
    }));
  }
  if (authorization.status === "forbidden") {
    return withCors(Response.json({ error: "Project access forbidden." }, {
      status: 403,
    }));
  }
  if (authorization.status === "unauthenticated") {
    const kecoPublicUrl = normalizePublicOrigin(
      deps.kecoPublicUrl ?? Deno.env.get("KECO_PUBLIC_URL"),
    );
    if (!kecoPublicUrl) {
      return withCors(Response.json({ error: "MCP authentication is unavailable." }, {
        status: 500,
      }));
    }
    const metadata =
      `${kecoPublicUrl}/api/mcp/oauth-protected-resource?project_id=${projectId}`;
    return withCors(Response.json({ error: "Authentication required." }, {
      status: 401,
      headers: { "www-authenticate": `Bearer resource_metadata="${metadata}"` },
    }));
  }
  const handleProtocol = deps.handleProtocol ?? handleProtocolRequest;
  const protocolResponse = await boundedProtocolResponse(
    await handleProtocol(boundedRequest),
  );
  if (!protocolResponse) {
    return withCors(Response.json({ error: "MCP response must remain below 1 MiB." }, {
      status: 502,
    }));
  }
  return withCors(protocolResponse);
}
