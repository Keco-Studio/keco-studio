import { readFile } from 'node:fs/promises';
import { replaceEvidenceAtomically } from './lib/atomic-evidence';
import { createMcpRpcClient, structuredToolResult, type McpRpcClient } from './lib/mcp-json-rpc';
import { percentile95 } from './probe-mcp-performance';

const MCP_RESPONSE_LIMIT_BYTES = 1024 * 1024;

export const LOAD_THRESHOLDS_MS = {
  static: 300, read: 800, structure: 1000, write: 1000, search: 3000, cold: 2000,
} as const;

export type FixtureManifest = {
  tables: number; fields: number; rows: number; documents: number;
  writeTableId?: string; writeFieldLabel?: string;
};

export function validateFixtureManifest(value: unknown): FixtureManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Load fixture manifest must be an object.');
  }
  const manifest = value as Record<string, unknown>;
  for (const [key, minimum] of Object.entries({ tables: 100, fields: 2000, rows: 100000, documents: 1000 })) {
    if (!Number.isInteger(manifest[key]) || Number(manifest[key]) < minimum) {
      throw new Error(`Load fixture requires at least ${minimum} ${key}.`);
    }
  }
  if ((manifest.writeTableId === undefined) !== (manifest.writeFieldLabel === undefined)) {
    throw new Error('Load fixture write target is incomplete.');
  }
  return manifest as FixtureManifest;
}

export function evaluateLoadBudgets(samples: Record<keyof typeof LOAD_THRESHOLDS_MS, number[]>) {
  const measurements = Object.fromEntries(Object.entries(samples).map(([key, values]) => [key,
    values.length === 0 ? null : { sampleCount: values.length, p95Ms: percentile95(values),
      budgetMs: LOAD_THRESHOLDS_MS[key as keyof typeof LOAD_THRESHOLDS_MS] },
  ])) as Record<keyof typeof LOAD_THRESHOLDS_MS,
    { sampleCount: number; p95Ms: number; budgetMs: number } | null>;
  return { passed: Object.values(measurements).every(item => item === null || item.p95Ms < item.budgetMs),
    measurements };
}

async function timed<T>(now: () => number, action: () => Promise<T>) {
  const started = now();
  const value = await action();
  return { value, elapsedMs: now() - started };
}

async function tool(client: McpRpcClient, name: string, args: Record<string, unknown>) {
  return structuredToolResult(await client.call('tools/call', { name, arguments: args }));
}

export async function runLoadProbe(options: {
  mcpUrl: string; accessToken: string; fixture: FixtureManifest; samples?: number;
  exerciseWrites?: boolean; exerciseRateLimit?: boolean; fetchImpl?: typeof fetch;
  now?: () => number;
}) {
  const fixture = validateFixtureManifest(options.fixture);
  const sampleCount = options.samples ?? 5;
  if (!Number.isInteger(sampleCount) || sampleCount < 1 || sampleCount > 20) {
    throw new Error('Load sample count must be an integer from 1 to 20.');
  }
  if (options.exerciseWrites && (!fixture.writeTableId || !fixture.writeFieldLabel)) {
    throw new Error('Write load requires a fixture write target.');
  }
  const client = createMcpRpcClient(options);
  const now = options.now ?? (() => performance.now());
  const samples: Record<keyof typeof LOAD_THRESHOLDS_MS, number[]> = {
    static: [], read: [], structure: [], write: [], search: [], cold: [],
  };
  const first = await timed(now, () => client.call('initialize', { protocolVersion: '2025-11-25',
    capabilities: {}, clientInfo: { name: 'keco-mcp-load-probe', version: '1' } }));
  samples.cold.push(first.elapsedMs);
  let cursorBoundary: 'not_applicable' | 'passed' = 'not_applicable';
  let payloadBoundary: 'passed' | null = null;
  let fixedStructureCall: 'passed' | null = null;
  let observedSearchMode: 'semantic' | 'text_fuzzy' | null = null;
  for (let index = 0; index < sampleCount; index += 1) {
    samples.static.push((await timed(now, () => client.call('tools/list'))).elapsedMs);
    const documentPage = await timed(now, () => tool(client, 'list_documents', { limit: 50 }));
    samples.read.push(documentPage.elapsedMs);
    if (index === 0) {
      const maximumDocumentPage = await tool(client, 'list_documents', { limit: 200 });
      const pageBytes = new TextEncoder().encode(JSON.stringify(maximumDocumentPage)).byteLength;
      if (pageBytes >= MCP_RESPONSE_LIMIT_BYTES || !Array.isArray(maximumDocumentPage.items) ||
          maximumDocumentPage.items.length > 200) {
        throw new Error('Document payload boundary failed.');
      }
      payloadBoundary = 'passed';
      const cursor = documentPage.value.nextCursor;
      if (documentPage.value.hasMore === true) {
        if (typeof cursor !== 'string' || !cursor) throw new Error('Document page omitted nextCursor.');
        await tool(client, 'list_documents', { limit: 50, cursor });
        cursorBoundary = 'passed';
      }
    }
    const structure = await timed(now, () => tool(client, 'list_project_structure', {}));
    samples.structure.push(structure.elapsedMs);
    if (index === 0) {
      const tables = Array.isArray(structure.value.tables)
        ? structure.value.tables as Array<Record<string, unknown>>
        : null;
      if (!Array.isArray(tables) || tables.length < fixture.tables ||
          tables.reduce((count, table) => count + (Array.isArray(table.fields)
            ? table.fields.length : 0), 0) < fixture.fields) {
        throw new Error('Project structure fixture boundary failed.');
      }
      fixedStructureCall = 'passed';
    }
    const search = await timed(now, () => tool(client, 'semantic_search', {
      query: `load fixture ${index}`, limit: 10,
    }));
    samples.search.push(search.elapsedMs);
    if (search.value.searchMode !== 'semantic' && search.value.searchMode !== 'text_fuzzy') {
      throw new Error('Load search omitted its actual searchMode.');
    }
    observedSearchMode = search.value.searchMode;
    if (options.exerciseWrites) {
      samples.write.push((await timed(now, () => tool(client, 'create_table_row', {
        tableId: fixture.writeTableId, reuseEmpty: index === 0,
        values: { [fixture.writeFieldLabel!]: `MCP load row ${Date.now()}-${index}` },
      }))).elapsedMs);
    }
  }
  let concurrentWrites: 'not_exercised' | 'passed' = 'not_exercised';
  if (options.exerciseWrites) {
    const writes = await Promise.all(Array.from({ length: 5 }, (_, index) => tool(client, 'create_table_row', {
      tableId: fixture.writeTableId, reuseEmpty: false,
      values: { [fixture.writeFieldLabel!]: `MCP concurrent row ${Date.now()}-${index}` },
    })));
    const rowIds = writes.map(value => {
      const data = value.data as unknown;
      const row = Array.isArray(data) ? data[0] : data;
      return row && typeof row === 'object' ? (row as Record<string, unknown>).row_id : null;
    });
    if (rowIds.some(id => typeof id !== 'string') || new Set(rowIds).size !== rowIds.length) {
      throw new Error('Concurrent MCP writes did not allocate unique rows.');
    }
    concurrentWrites = 'passed';
  }
  let rateLimit: 'not_exercised' | 'passed' = 'not_exercised';
  if (options.exerciseRateLimit) {
    let rejected = 0;
    for (let index = 0; index < 21; index += 1) {
      const result = await client.call('tools/call', { name: 'semantic_search',
        arguments: { query: `rate limit fixture ${index}`, limit: 1 } });
      const structured = result.structuredContent as Record<string, unknown> | undefined;
      const error = structured?.error as Record<string, unknown> | undefined;
      if (error?.code === 'RATE_LIMITED') rejected += 1;
    }
    if (rejected < 1) throw new Error('Search rate limit was not observed.');
    rateLimit = 'passed';
  }
  const evaluation = evaluateLoadBudgets(samples);
  if (fixedStructureCall !== 'passed' || payloadBoundary !== 'passed') {
    throw new Error('MCP Phase 2 response boundary gates failed.');
  }
  if (!evaluation.passed) throw new Error('MCP Phase 2 load budgets failed.');
  return { checkedAt: new Date().toISOString(), passed: true, mcpUrl: options.mcpUrl,
    scope: options.exerciseWrites ? 'full' : 'read_only',
    fixture: { tables: fixture.tables, fields: fixture.fields, rows: fixture.rows,
      documents: fixture.documents }, measurements: evaluation.measurements,
    gates: { fixedStructureCall, cursorBoundary, payloadBoundary,
      concurrentWrites, rateLimit, searchMode: observedSearchMode } };
}

function argument(args: string[], name: string): string {
  const index = args.indexOf(name);
  const value = args[index + 1];
  if (index < 0 || !value || value.startsWith('--')) throw new Error(`Missing ${name}.`);
  return value;
}

async function main() {
  const args = process.argv.slice(2);
  const output = argument(args, '--output');
  await replaceEvidenceAtomically(output, async () => {
    const fixture = validateFixtureManifest(JSON.parse(
      await readFile(argument(args, '--fixture-manifest'), 'utf8')));
    return runLoadProbe({ mcpUrl: argument(args, '--mcp-url'),
      accessToken: process.env.MCP_ACCESS_TOKEN ?? '', fixture,
      exerciseWrites: args.includes('--exercise-writes'),
      exerciseRateLimit: args.includes('--exercise-rate-limit') });
  });
}

if (process.argv[1]?.endsWith('load-mcp-phase-2.ts')) {
  void main().catch(() => { console.error('MCP Phase 2 load probe failed.'); process.exitCode = 1; });
}
