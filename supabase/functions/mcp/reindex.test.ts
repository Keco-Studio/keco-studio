import { assertEquals } from '@std/assert';
import { requestMcpReindex } from './reindex.ts';

const input = { kind: 'row' as const,
  projectId: '11111111-1111-4111-8111-111111111111',
  actorUserId: '22222222-2222-4222-8222-222222222222',
  rowId: '33333333-3333-4333-8333-333333333333' };

Deno.test('trusted reindex request stays bounded and keeps the secret in its header', async () => {
  Deno.env.set('KECO_PUBLIC_URL', 'https://keco.test');
  Deno.env.set('MCP_CODEC_SECRET', 'reindex-test-secret');
  let received: { url: string; authorization: string | null; body: unknown } | null = null;
  const ok = await requestMcpReindex(input, async (url, init) => {
    received = { url: String(url), authorization: new Headers(init?.headers).get('authorization'),
      body: JSON.parse(String(init?.body)) };
    return Response.json({ ok: true });
  });
  assertEquals(ok, true);
  assertEquals(received, { url: 'https://keco.test/api/mcp/reindex',
    authorization: 'Bearer reindex-test-secret', body: input });
});

Deno.test('trusted reindex request fails closed on missing config and upstream errors', async () => {
  Deno.env.delete('MCP_CODEC_SECRET');
  assertEquals(await requestMcpReindex(input), false);
  Deno.env.set('MCP_CODEC_SECRET', 'reindex-test-secret');
  assertEquals(await requestMcpReindex(input, async () => new Response(null, { status: 503 })), false);
});
