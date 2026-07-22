import { assertEquals } from '@std/assert';
import { LATEST_PROTOCOL_VERSION } from '@mcp/types.js';
import { handleProtocolRequest } from './server.ts';
import type { McpRequestContext } from './context.ts';

const context = {
  requestId: 'request-1',
  userId: 'user-1',
  projectId: '11111111-1111-4111-8111-111111111111',
  role: 'editor',
  clientId: null,
  bearerToken: 'test-token',
  supabase: {},
} as unknown as McpRequestContext;

async function rpc(method: string, params: Record<string, unknown> = {}) {
  const response = await handleProtocolRequest(new Request('http://localhost/mcp/project', {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  }), context);
  assertEquals(response.status, 200);
  return await response.json() as {
    result?: Record<string, unknown>;
    error?: { code: number; message: string };
  };
}

Deno.test('initialize declares only the tools capability', async () => {
  const message = await rpc('initialize', {
    protocolVersion: LATEST_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'phase-1-test', version: '1.0.0' },
  });
  assertEquals(message.error, undefined);
  assertEquals(message.result?.protocolVersion, LATEST_PROTOCOL_VERSION);
  assertEquals(message.result?.serverInfo, { name: 'keco-mcp', version: '0.3.1' });
  assertEquals(message.result?.capabilities, { tools: { listChanged: true } });
});

Deno.test('tools/list exposes one read-only connection probe', async () => {
  const message = await rpc('tools/list');
  assertEquals(message.error, undefined);
  assertEquals(message.result?.tools, [{
    name: 'keco_connection_probe',
    description: 'Verify that the authenticated Keco MCP connection is operational.',
    inputSchema: { type: 'object', properties: {} },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    execution: { taskSupport: 'forbidden' },
  }]);
});

Deno.test('ping returns an empty result', async () => {
  const message = await rpc('ping');
  assertEquals(message.error, undefined);
  assertEquals(message.result, {});
});

Deno.test('tools/call returns a bounded static result', async () => {
  const message = await rpc('tools/call', {
    name: 'keco_connection_probe',
    arguments: {},
  });
  assertEquals(message.error, undefined);
  assertEquals(message.result, {
    content: [{ type: 'text', text: 'Keco MCP connection is operational.' }],
    structuredContent: { ok: true, phase: 1 },
  });
});
