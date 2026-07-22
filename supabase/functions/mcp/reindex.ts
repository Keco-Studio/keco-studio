const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type McpReindexRequest =
  | { kind: 'table'; projectId: string; actorUserId: string; tableId: string }
  | { kind: 'row'; projectId: string; actorUserId: string; rowId: string }
  | { kind: 'document'; projectId: string; actorUserId: string; documentId: string };

function configured(): { url: URL; secret: string } | null {
  const origin = Deno.env.get('KECO_PUBLIC_URL');
  const secret = Deno.env.get('MCP_CODEC_SECRET');
  if (!origin || !secret) return null;
  try { return { url: new URL('/api/mcp/reindex', origin), secret }; }
  catch { return null; }
}

export async function requestMcpReindex(
  input: McpReindexRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const target = configured();
  if (!target || !Object.values(input).filter((value) => typeof value === 'string')
    .every((value) => value === input.kind || UUID.test(value))) return false;
  try {
    const response = await fetchImpl(target.url, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + target.secret, 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    return response.ok;
  } catch { return false; }
}

export function scheduleMcpReindex(input: McpReindexRequest): void {
  const task = requestMcpReindex(input).then((ok) => {
    console.log(JSON.stringify({ event: 'keco_mcp_reindex', kind: input.kind,
      outcome: ok ? 'succeeded' : 'failed' }));
  });
  const edgeRuntime = (globalThis as unknown as {
    EdgeRuntime?: { waitUntil(promise: Promise<unknown>): void };
  }).EdgeRuntime;
  if (edgeRuntime) edgeRuntime.waitUntil(task);
  else void task;
}
