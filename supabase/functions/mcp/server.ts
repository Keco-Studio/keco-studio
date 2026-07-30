import { McpServer } from "@mcp/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@mcp/server/webStandardStreamableHttp.js";
import type { McpRequestContext } from "./context.ts";
import { registerReadTools } from "./read-tools.ts";
import { registerResources } from "./resources.ts";
import { registerWriteTools } from "./write-tools.ts";
import { registerPrompts } from "./prompts.ts";
import {
  type McpOperationClass,
  runMcpProtocolOperation,
} from "./telemetry.ts";
import { toolFailure } from "./results.ts";
import { asPublicMcpError } from "./errors.ts";
import { registerAccountTools } from "./account-tools.ts";

const READ_TOOLS = new Set([
  "list_projects",
  "list_project_structure",
  "query_table_rows",
  "list_documents",
  "read_document",
]);
const WRITE_TOOLS = new Set([
  "create_table",
  "create_table_row",
  "update_table_row",
  "create_document",
  "update_document",
  "create_image_upload",
  "complete_image_upload",
]);
const STATIC_METHODS = new Set([
  "initialize",
  "ping",
  "tools/list",
  "resources/list",
  "resources/templates/list",
  "prompts/list",
  "prompts/get",
  "notifications/initialized",
]);

async function protocolEnvelope(request: Request): Promise<{
  id: string | number | null;
  method: string;
  operation: string;
  operationClass: McpOperationClass;
  requestBytes: number;
}> {
  if (request.method !== "POST") {
    return {
      id: null,
      method: request.method,
      operation: "protocol_" + request.method.toLowerCase(),
      operationClass: "static",
      requestBytes: 0,
    };
  }
  let requestBytes = 0;
  try {
    const bytes = new Uint8Array(await request.clone().arrayBuffer());
    requestBytes = bytes.byteLength;
    const body = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
    if (
      !body || Array.isArray(body) || body.jsonrpc !== "2.0" ||
      typeof body.method !== "string"
    ) {
      return {
        id: null,
        method: "invalid",
        operation: "protocol_invalid_request",
        operationClass: "static",
        requestBytes,
      };
    }
    const id = typeof body.id === "string" || typeof body.id === "number" ||
        body.id === null
      ? body.id
      : null;
    if (body.method === "tools/call") {
      const name = body.params?.name;
      if (name === "keco_connection_probe") {
        return {
          id,
          method: body.method,
          operation: name,
          operationClass: "static",
          requestBytes,
        };
      }
      if (name === "semantic_search") {
        return {
          id,
          method: body.method,
          operation: name,
          operationClass: "search",
          requestBytes,
        };
      }
      if (typeof name === "string" && READ_TOOLS.has(name)) {
        return {
          id,
          method: body.method,
          operation: name,
          operationClass: "read",
          requestBytes,
        };
      }
      if (typeof name === "string" && WRITE_TOOLS.has(name)) {
        return {
          id,
          method: body.method,
          operation: name,
          operationClass: "write",
          requestBytes,
        };
      }
      return {
        id,
        method: body.method,
        operation: "unknown_tool",
        operationClass: "static",
        requestBytes,
      };
    }
    if (body.method === "resources/read") {
      return {
        id,
        method: body.method,
        operation: "resource_read",
        operationClass: "read",
        requestBytes,
      };
    }
    if (STATIC_METHODS.has(body.method)) {
      return {
        id,
        method: body.method,
        operation: "protocol_" + body.method.replaceAll("/", "_"),
        operationClass: "static",
        requestBytes,
      };
    }
    return {
      id,
      method: body.method,
      operation: "protocol_unknown_method",
      operationClass: "static",
      requestBytes,
    };
  } catch {
    return {
      id: null,
      method: "invalid",
      operation: "protocol_invalid_request",
      operationClass: "static",
      requestBytes,
    };
  }
}

export async function createProbeServer(
  context: McpRequestContext,
): Promise<McpServer> {
  const capabilities = {
    tools: { listChanged: true },
    resources: { listChanged: false },
    prompts: { listChanged: true },
  };
  const server = new McpServer(
    { name: "keco-mcp", version: "0.3.1" },
    { capabilities },
  );

  server.registerTool("keco_connection_probe", {
    description:
      "Verify that the authenticated Keco MCP connection is operational.",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  }, async () => {
    return {
      content: [{
        type: "text" as const,
        text: "Keco MCP connection is operational.",
      }],
      structuredContent: { ok: true, phase: 2 },
    };
  });

  if (context.mode === "account") {
    await registerAccountTools(server, context);
    registerResources(server, context);
    registerPrompts(server, context);
  } else {
    registerReadTools(server, context);
    registerWriteTools(server, context);
    registerResources(server, context);
    registerPrompts(server, context);
  }

  return server;
}

export async function handleProtocolRequest(
  request: Request,
  context: McpRequestContext,
  dependencies: {
    handleTransport?: (request: Request) => Promise<Response>;
  } = {},
): Promise<Response> {
  const envelope = await protocolEnvelope(request);
  try {
    const handleTransport = async () => {
      const server = await createProbeServer(context);
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      await server.connect(transport);
      return await (dependencies.handleTransport?.(request) ??
        transport.handleRequest(request));
    };
    return await runMcpProtocolOperation(context, envelope, handleTransport);
  } catch (error) {
    const safe = asPublicMcpError(error);
    if (envelope.method === "tools/call") {
      return Response.json({
        jsonrpc: "2.0",
        id: envelope.id,
        result: toolFailure(error),
      });
    }
    return Response.json({
      jsonrpc: "2.0",
      id: envelope.id,
      error: {
        code: -32000,
        message: safe.message,
        data: { code: safe.code, retryAfterSeconds: safe.retryAfterSeconds },
      },
    });
  }
}
