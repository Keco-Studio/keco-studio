import { assertEquals, assertRejects } from '@std/assert';
import type { McpRequestContext } from './context.ts';
import { McpDomainError } from './errors.ts';
import { semanticSearch } from './operations.ts';

const projectId = '11111111-1111-4111-8111-111111111111';
const originalFetch = globalThis.fetch;
const envNames = ['MCP_EMBEDDING_URL', 'MCP_EMBEDDING_KEY', 'MCP_EMBEDDING_MODEL'] as const;

function context(rpc: (name: string, parameters: Record<string, unknown>) => unknown) {
  return { projectId, supabase: { async rpc(name: string, parameters: Record<string, unknown>) {
    return await rpc(name, parameters);
  } } } as unknown as McpRequestContext;
}

function configureEmbedding(): void {
  Deno.env.set('MCP_EMBEDDING_URL', 'https://embedding.test/v1/embeddings');
  Deno.env.set('MCP_EMBEDDING_KEY', 'test-provider-key');
  Deno.env.set('MCP_EMBEDDING_MODEL', 'test-model');
}

function vectorResponse(): Response {
  return Response.json({ data: [{ embedding: Array.from({ length: 1536 }, () => 0.25) }] });
}

Deno.test({ name: 'semantic search uses and caches a valid embedding without exposing its query',
  sanitizeOps: false, sanitizeResources: false, fn: async () => {
    configureEmbedding();
    let fetches = 0;
    globalThis.fetch = async (_input, init) => {
      fetches += 1;
      assertEquals(new Headers(init?.headers).get('authorization'), 'Bearer test-provider-key');
      return vectorResponse();
    };
    const calls: Array<{ name: string; parameters: Record<string, unknown> }> = [];
    const ctx = context((name, parameters) => {
      calls.push({ name, parameters });
      return { data: [{ source_type: 'project_document', source_id: 'doc-1' }], error: null };
    });
    const first = await semanticSearch(ctx, { query: 'unique semantic cache query', source: 'documents' });
    const second = await semanticSearch(ctx, { query: 'unique semantic cache query', source: 'documents' });
    assertEquals(first.searchMode, 'semantic');
    assertEquals(second.degraded, false);
    assertEquals(fetches, 1);
    assertEquals(calls.map(call => call.name), ['mcp_vector_search', 'mcp_vector_search']);
    assertEquals(calls[0].parameters.p_source, 'documents');
  } });

Deno.test('semantic search reports every stable embedding degradation reason', async () => {
  const scenarios: Array<{ reason: string; setup: () => void; fetch?: typeof fetch }> = [
    { reason: 'embedding_not_configured', setup: () => envNames.forEach(name => Deno.env.delete(name)) },
    { reason: 'embedding_timeout', setup: configureEmbedding,
      fetch: async () => { throw new DOMException('aborted', 'AbortError'); } },
    { reason: 'embedding_rate_limited', setup: configureEmbedding,
      fetch: async () => new Response(null, { status: 429 }) },
    { reason: 'embedding_invalid_response', setup: configureEmbedding,
      fetch: async () => Response.json({ data: [{ embedding: [1, 2] }] }) },
  ];
  for (const scenario of scenarios) {
    scenario.setup();
    if (scenario.fetch) globalThis.fetch = scenario.fetch;
    const result = await semanticSearch(context(name => {
      assertEquals(name, 'mcp_text_search');
      return { data: [], error: null };
    }), { query: 'degradation ' + scenario.reason });
    assertEquals(result.searchMode, 'text_fuzzy');
    assertEquals(result.degradationReason, scenario.reason);
  }

  configureEmbedding();
  globalThis.fetch = async () => vectorResponse();
  const vectorUnavailable = await semanticSearch(context(name => name === 'mcp_vector_search'
    ? { data: null, error: { code: 'XX000', message: 'private database detail' } }
    : { data: [], error: null }), { query: 'unique vector unavailable query' });
  assertEquals(vectorUnavailable.degradationReason, 'vector_search_unavailable');
});

Deno.test('semantic search fails safely when semantic and text paths both fail', async () => {
  envNames.forEach(name => Deno.env.delete(name));
  await assertRejects(
    () => semanticSearch(context(() => ({ data: null,
      error: { code: 'XX000', message: 'private database detail' } })), { query: 'both fail' }),
    McpDomainError,
    'Semantic and text search are unavailable.',
  );
});

Deno.test({ name: 'restore semantic search globals', sanitizeOps: false,
  sanitizeResources: false, fn: () => {
    globalThis.fetch = originalFetch;
    envNames.forEach(name => Deno.env.delete(name));
  } });
