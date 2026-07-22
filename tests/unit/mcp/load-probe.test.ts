import { expect, it, jest } from '@jest/globals';
import { evaluateLoadBudgets, runLoadProbe, validateFixtureManifest }
  from '../../../scripts/load-mcp-phase-2';

const fixture = { tables: 100, fields: 2000, rows: 100000, documents: 1000 };
const endpoint = 'https://example.supabase.co/functions/v1/mcp/11111111-1111-4111-8111-111111111111';

it('requires every representative fixture scale', () => {
  expect(validateFixtureManifest(fixture)).toEqual(fixture);
  expect(() => validateFixtureManifest({ ...fixture, rows: 99999 })).toThrow('100000 rows');
});

it('enforces strict nearest-rank P95 budgets for every operation class', () => {
  const samples = { static: [299], read: [799], structure: [999], write: [999],
    search: [2999], cold: [1999] };
  expect(evaluateLoadBudgets(samples).passed).toBe(true);
  expect(evaluateLoadBudgets({ ...samples, read: [800] }).passed).toBe(false);
});

it('runs bounded protocol samples and omits credentials from evidence', async () => {
  const token = 'header.payload.signature';
  let clock = 0;
  const fetchMock = jest.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${token}`);
    const message = JSON.parse(String(init?.body)) as { id: number; method: string;
      params?: { name?: string } };
    clock += 10;
    return Response.json({ jsonrpc: '2.0', id: message.id, result: message.method === 'tools/call'
      ? { structuredContent: message.params?.name === 'semantic_search'
        ? { ok: true, searchMode: 'text_fuzzy' }
        : message.params?.name === 'list_documents'
          ? { ok: true, items: [], hasMore: false, nextCursor: null } : { ok: true } } : {} });
  });
  const evidence = await runLoadProbe({ mcpUrl: endpoint, accessToken: token, fixture, samples: 1,
    fetchImpl: fetchMock as typeof fetch, now: () => clock });
  expect(evidence.passed).toBe(true);
  expect(evidence.measurements.read.p95Ms).toBe(10);
  expect(evidence.measurements.write).toBeNull();
  expect(evidence.scope).toBe('read_only');
  expect(evidence.gates.concurrentWrites).toBe('not_exercised');
  expect(evidence.gates.cursorBoundary).toBe('not_applicable');
  expect(evidence.gates.searchMode).toBe('text_fuzzy');
  expect(JSON.stringify(evidence)).not.toContain(token);
});
