import {
  authorizeAccount,
  authorizeProject,
  type AccountAuthorization,
  type AccountAuthContext,
  type ProjectAuthorization,
  type ProjectAuthContext,
} from "./auth.ts";
import { handleProtocolRequest } from "./server.ts";
import { createMcpRequestContext, type McpRequestContext } from "./context.ts";
import { MAX_REQUEST_BYTES, MAX_RESPONSE_BYTES } from "./limits.ts";
import {
  buildProtectedResourceMetadata,
  buildProtectedResourceMetadataUrl,
  InvalidMcpMetadataConfigError,
  InvalidMcpMetadataRequestError,
  isProtectedResourceMetadataPath,
  parseProtectedResourceMetadataProjectId,
} from "./oauth-metadata.ts";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers":
    "Authorization, Content-Type, Accept, MCP-Protocol-Version, MCP-Session-Id, Last-Event-ID",
  "access-control-expose-headers":
    "MCP-Protocol-Version, MCP-Session-Id, WWW-Authenticate",
};

export type McpEndpoint =
  | { mode: "account" }
  | { mode: "project"; projectId: string };

export function extractMcpEndpoint(url: URL): McpEndpoint | null {
  // Supabase's gateway strips `/functions/v1` before invoking the function,
  // while local/direct requests retain the public prefix. Only the account
  // root and a single UUID project segment are valid endpoint shapes.
  if (
    url.username ||
    url.password ||
    url.href.includes("?") ||
    url.href.includes("#")
  ) return null;
  if (/^(?:\/functions\/v1)?\/mcp$/.test(url.pathname)) {
    return { mode: "account" };
  }
  const match = /^(?:\/functions\/v1)?\/mcp\/([^/]+)$/.exec(url.pathname);
  return match && UUID.test(match[1])
    ? { mode: "project", projectId: match[1] }
    : null;
}

/** @deprecated Use extractMcpEndpoint to distinguish account and project routes. */
export function extractBoundProjectId(url: URL): string | null {
  const endpoint = extractMcpEndpoint(url);
  return endpoint?.mode === "project" ? endpoint.projectId : null;
}

export type McpHttpDependencies = {
  /** Legacy alias for authorizeProject, retained for existing callers. */
  authorize?: (
    request: Request,
    projectId: string,
  ) => Promise<ProjectAuthorization>;
  authorizeProject?: (
    request: Request,
    projectId: string,
  ) => Promise<ProjectAuthorization>;
  authorizeAccount?: (request: Request) => Promise<AccountAuthorization>;
  supabaseUrl?: string;
  createContext?: (
    request: Request,
    authContext: ProjectAuthContext | AccountAuthContext,
  ) => McpRequestContext;
  handleProtocol?: (
    request: Request,
    context: McpRequestContext,
  ) => Promise<Response>;
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
      if (total + value.byteLength >= MAX_REQUEST_BYTES) {
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
  return Number.isFinite(declaredLength) && declaredLength >= MAX_REQUEST_BYTES;
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
  const url = new URL(request.url);
  if (request.method === "GET" && isProtectedResourceMetadataPath(url)) {
    try {
      const projectId = parseProtectedResourceMetadataProjectId(url);
      const metadata = buildProtectedResourceMetadata(
        deps.supabaseUrl ?? Deno.env.get("SUPABASE_URL"),
        projectId,
      );
      return withCors(Response.json(metadata, {
        headers: { "cache-control": "public, max-age=300" },
      }));
    } catch (error) {
      if (error instanceof InvalidMcpMetadataRequestError) {
        return withCors(Response.json({ error: "Invalid MCP metadata request." }, {
          status: 400,
        }));
      }
      if (error instanceof InvalidMcpMetadataConfigError) {
        return withCors(Response.json({ error: "MCP metadata is not configured." }, {
          status: 500,
        }));
      }
      return withCors(Response.json({ error: "MCP metadata is unavailable." }, {
        status: 500,
      }));
    }
  }
  const endpoint = extractMcpEndpoint(url);
  if (!endpoint) {
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
  let authorization: ProjectAuthorization | AccountAuthorization;
  try {
    authorization = endpoint.mode === "account"
      ? await (deps.authorizeAccount ?? authorizeAccount)(boundedRequest)
      : await (deps.authorizeProject ?? deps.authorize ?? authorizeProject)(
        boundedRequest,
        endpoint.projectId,
      );
  } catch {
    authorization = { status: "operational_error" };
  }
  if (authorization.status === "operational_error") {
    return withCors(Response.json({ error: "MCP authorization is unavailable." }, {
      status: 503,
    }));
  }
  if (authorization.status === "forbidden") {
    return withCors(Response.json({
      error: endpoint.mode === "account"
        ? "Account access forbidden."
        : "Project access forbidden.",
    }, {
      status: 403,
    }));
  }
  if (authorization.status === "unauthenticated") {
    let metadata: string;
    try {
      metadata = buildProtectedResourceMetadataUrl(
        deps.supabaseUrl ?? Deno.env.get("SUPABASE_URL"),
        endpoint.mode === "project" ? endpoint.projectId : null,
      );
    } catch {
      return withCors(Response.json({ error: "MCP authentication is unavailable." }, {
        status: 500,
      }));
    }
    return withCors(Response.json({ error: "Authentication required." }, {
      status: 401,
      headers: { "www-authenticate": `Bearer resource_metadata="${metadata}"` },
    }));
  }
  const handleProtocol = deps.handleProtocol ?? handleProtocolRequest;
  let context: McpRequestContext;
  try {
    context = (deps.createContext ?? createMcpRequestContext)(
      boundedRequest,
      authorization.context,
    );
  } catch {
    return withCors(Response.json({ error: "MCP request context is unavailable." }, {
      status: 503,
    }));
  }
  const protocolResponse = await boundedProtocolResponse(
    await handleProtocol(boundedRequest, context),
  );
  if (!protocolResponse) {
    return withCors(Response.json({ error: "MCP response must remain below 1 MiB." }, {
      status: 502,
    }));
  }
  return withCors(protocolResponse);
}
