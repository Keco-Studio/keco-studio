import { McpServer } from '@mcp/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@mcp/server/webStandardStreamableHttp.js';

export function createProbeServer(): McpServer {
  const server = new McpServer(
    { name: 'keco-mcp', version: '0.3.1' },
    { capabilities: { tools: { listChanged: true } } },
  );

  server.registerTool('keco_connection_probe', {
    description: 'Verify that the authenticated Keco MCP connection is operational.',
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  }, async () => ({
    content: [{ type: 'text' as const, text: 'Keco MCP connection is operational.' }],
    structuredContent: { ok: true, phase: 1 },
  }));

  return server;
}

export async function handleProtocolRequest(request: Request): Promise<Response> {
  const server = createProbeServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return await transport.handleRequest(request);
}
