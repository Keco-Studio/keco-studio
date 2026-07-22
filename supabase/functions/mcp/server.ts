import { McpServer } from '@mcp/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@mcp/server/webStandardStreamableHttp.js';
import type { McpRequestContext } from './context.ts';
import { registerReadTools } from './read-tools.ts';
import { registerResources } from './resources.ts';
import { registerWriteTools } from './write-tools.ts';
import { registerPrompts } from './prompts.ts';
import { runMcpOperation } from './telemetry.ts';
import { toolFailure } from './results.ts';
import { asPublicMcpError } from './errors.ts';

const STATIC_PROTOCOL_METHODS = new Set([
  'initialize', 'ping', 'tools/list', 'resources/list',
  'resources/templates/list', 'prompts/list',
]);

async function protocolEnvelope(request: Request): Promise<{
  id: string | number | null; method: string;
} | null> {
  if (request.method !== 'POST') return null;
  try {
    const body = await request.clone().json();
    return body && body.jsonrpc === '2.0' && typeof body.method === 'string'
      ? { id: body.id ?? null, method: body.method }
      : null;
  } catch { return null; }
}

export function createProbeServer(context: McpRequestContext): McpServer {
  const server = new McpServer(
    { name: 'keco-mcp', version: '0.3.1' },
    { capabilities: { tools: { listChanged: true }, resources: { listChanged: false }, prompts: { listChanged: true } } },
  );

  server.registerTool('keco_connection_probe', {
    description: 'Verify that the authenticated Keco MCP connection is operational.',
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  }, async () => {
    try {
      const structuredContent = await runMcpOperation(
        context, 'keco_connection_probe', 'static', {}, async () => ({ ok: true, phase: 2 }),
      );
      return { content: [{ type: 'text' as const, text: 'Keco MCP connection is operational.' }],
        structuredContent };
    } catch (error) { return toolFailure(error); }
  });

  registerReadTools(server, context);
  registerWriteTools(server, context);

  registerResources(server, context);
  registerPrompts(server, context);

  return server;
}

export async function handleProtocolRequest(
  request: Request,
  context: McpRequestContext,
): Promise<Response> {
  const server = createProbeServer(context);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  const envelope = await protocolEnvelope(request);
  if (!envelope || !STATIC_PROTOCOL_METHODS.has(envelope.method)) {
    return await transport.handleRequest(request);
  }
  try {
    return await runMcpOperation(context,
      'protocol_' + envelope.method.replaceAll('/', '_'), 'static',
      { method: envelope.method }, () => transport.handleRequest(request));
  } catch (error) {
    const safe = asPublicMcpError(error);
    return Response.json({ jsonrpc: '2.0', id: envelope.id,
      error: { code: -32000, message: safe.message,
        data: { code: safe.code, retryAfterSeconds: safe.retryAfterSeconds } } });
  }
}
