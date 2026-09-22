export type McpRpcSession = {
  endpoint: string;
  accessToken: string;
  nextId: number;
};

export type McpRpcResponse = {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: { code?: string };
  };
};

function stableCode(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(value)
    ? value
    : fallback;
}

function parseJson(text: string): unknown {
  return JSON.parse(text) as unknown;
}

function parseSse(text: string): unknown {
  const payloads = text
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice('data:'.length).trim())
    .filter((payload) => payload && payload !== '[DONE]');
  if (payloads.length === 0) throw new Error('SSE response omitted data');
  return parseJson(payloads[payloads.length - 1]);
}

function asRpcResponse(value: unknown): McpRpcResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('JSON-RPC response is not an object');
  }
  const response = value as Partial<McpRpcResponse>;
  if (response.jsonrpc !== '2.0') throw new Error('JSON-RPC response omitted version');
  return response as McpRpcResponse;
}

export async function mcpRpc(
  session: McpRpcSession,
  method: string,
  params?: Record<string, unknown>
): Promise<McpRpcResponse> {
  const id = session.nextId++;
  let response: Response;
  try {
    response = await fetch(session.endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${session.accessToken}`,
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
        'mcp-protocol-version': '2025-06-18',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) }),
    });
  } catch {
    throw new Error(`MCP ${method} failed (NETWORK_ERROR)`);
  }

  let parsed: unknown;
  try {
    const text = await response.text();
    parsed = response.headers.get('content-type')?.includes('text/event-stream')
      ? parseSse(text)
      : parseJson(text);
  } catch {
    throw new Error(`MCP ${method} failed (${response.status}, INVALID_RESPONSE)`);
  }

  if (!response.ok) {
    const rpc = parsed as Partial<McpRpcResponse>;
    const code = stableCode(rpc.error?.data?.code, `HTTP_${response.status}`);
    throw new Error(`MCP ${method} failed (${response.status}, ${code})`);
  }

  let rpc: McpRpcResponse;
  try {
    rpc = asRpcResponse(parsed);
  } catch {
    throw new Error(`MCP ${method} failed (${response.status}, INVALID_RESPONSE)`);
  }
  if (rpc.id !== id) throw new Error(`MCP ${method} failed (${response.status}, ID_MISMATCH)`);
  return rpc;
}
