import { authorizeProject, type ProjectAuthContext } from "./auth.ts";
import { handleProtocolRequest } from "./server.ts";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_REQUEST_BYTES = 256 * 1024;
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers":
    "Authorization, Content-Type, Accept, MCP-Protocol-Version, MCP-Session-Id, Last-Event-ID",
  "access-control-expose-headers":
    "MCP-Protocol-Version, MCP-Session-Id, WWW-Authenticate",
};

export function extractBoundProjectId(url: URL): string | null {
  const parts = url.pathname.split("/").filter(Boolean);
  const index = parts.lastIndexOf("mcp");
  if (index < 0 || index !== parts.length - 2) return null;
  return UUID.test(parts[index + 1]) ? parts[index + 1] : null;
}

export type McpHttpDependencies = {
  authorize?: (
    request: Request,
    projectId: string,
  ) => Promise<ProjectAuthContext | null>;
  kecoPublicUrl?: string;
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
  const context = await authorize(boundedRequest, projectId);
  if (!context) {
    const kecoPublicUrl =
      (deps.kecoPublicUrl ?? Deno.env.get("KECO_PUBLIC_URL") ?? "").replace(
        /\/$/,
        "",
      );
    const metadata =
      `${kecoPublicUrl}/api/mcp/oauth-protected-resource?project_id=${projectId}`;
    return withCors(Response.json({ error: "Authentication required." }, {
      status: 401,
      headers: { "www-authenticate": `Bearer resource_metadata="${metadata}"` },
    }));
  }
  return withCors(await handleProtocolRequest(boundedRequest));
}
