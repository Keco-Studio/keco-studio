export const MCP_PROTOCOL_VERSION = '2025-11-25';

export type McpRpcClient = {
  call(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>;
};

export function createMcpRpcClient(options: {
  mcpUrl: string;
  accessToken: string;
  fetchImpl?: typeof fetch;
}): McpRpcClient {
  if (!options.accessToken) throw new Error('MCP_ACCESS_TOKEN is required.');
  const endpoint = new URL(options.mcpUrl);
  if (endpoint.protocol !== 'https:' && endpoint.hostname !== '127.0.0.1' &&
      endpoint.hostname !== 'localhost') {
    throw new Error('MCP endpoint must use HTTPS.');
  }
  const request = options.fetchImpl ?? fetch;
  let id = 1;
  return {
    async call(method, params = {}) {
      const requestId = id++;
      let response: Response;
      try {
        response = await request(endpoint, {
          method: 'POST',
          headers: {
            accept: 'application/json, text/event-stream',
            authorization: `Bearer ${options.accessToken}`,
            'content-type': 'application/json',
            'mcp-protocol-version': MCP_PROTOCOL_VERSION,
          },
          body: JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }),
        });
      } catch {
        throw new Error(`MCP ${method} request failed.`);
      }
      if (!response.ok) throw new Error(`MCP ${method} failed with HTTP ${response.status}.`);
      let message: Record<string, unknown>;
      try {
        message = await response.json() as Record<string, unknown>;
      } catch {
        throw new Error(`MCP ${method} returned invalid JSON.`);
      }
      if (message.jsonrpc !== '2.0' || message.id !== requestId ||
          typeof message.result !== 'object' || message.result === null || message.error) {
        throw new Error(`MCP ${method} returned an invalid response.`);
      }
      return message.result as Record<string, unknown>;
    },
  };
}

export function structuredToolResult(result: Record<string, unknown>, expectedError?: string) {
  const structured = result.structuredContent;
  if (!structured || typeof structured !== 'object' || Array.isArray(structured)) {
    throw new Error('MCP Tool result omitted structuredContent.');
  }
  const value = structured as Record<string, unknown>;
  if (expectedError) {
    const error = value.error as Record<string, unknown> | undefined;
    if (result.isError !== true || value.ok !== false || error?.code !== expectedError) {
      throw new Error(`MCP Tool did not return ${expectedError}.`);
    }
  } else if (result.isError === true || value.ok === false) {
    throw new Error('MCP Tool returned a domain error.');
  }
  return value;
}
