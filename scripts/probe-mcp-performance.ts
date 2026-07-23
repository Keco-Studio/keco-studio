import { replaceEvidenceAtomically } from './lib/atomic-evidence';

const COLD_LIMIT_MS = 2000;
const WARM_LIMIT_MS = 300;
const READ_LIMIT_MS = 800;
const STRUCTURE_LIMIT_MS = 1000;
const SEARCH_LIMIT_MS = 3000;
const DEFAULT_WARM_SAMPLES = 20;
const DEFAULT_PHASE_2_SAMPLES = 5;
const PROTOCOL_VERSION = '2025-11-25';
const COLD_GATE_UNVERIFIED_REASON = 'cold-start-not-verified' as const;

function isAccountEndpoint(mcpUrl: string): boolean {
  const url = new URL(mcpUrl);
  return /^(?:\/functions\/v1)?\/mcp$/.test(url.pathname);
}

export interface PerformanceSamples {
  firstRequestMs: number;
  coldVerified: boolean;
  warmInitializeMs: number[];
  warmToolsListMs: number[];
}

export interface PerformanceEvaluation {
  passed: boolean;
  firstRequestMs: number;
  coldVerified: boolean;
  coldGateReason?: typeof COLD_GATE_UNVERIFIED_REASON;
  warmInitializeP95Ms: number;
  warmToolsListP95Ms: number;
}

export function percentile95(samples: readonly number[]): number {
  if (samples.length === 0) throw new Error('P95 requires at least one sample.');
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * 0.95) - 1];
}

export function evaluatePerformance(samples: PerformanceSamples): PerformanceEvaluation {
  const warmInitializeP95Ms = percentile95(samples.warmInitializeMs);
  const warmToolsListP95Ms = percentile95(samples.warmToolsListMs);
  return {
    passed: samples.coldVerified
      && samples.firstRequestMs < COLD_LIMIT_MS
      && warmInitializeP95Ms < WARM_LIMIT_MS
      && warmToolsListP95Ms < WARM_LIMIT_MS,
    firstRequestMs: samples.firstRequestMs,
    coldVerified: samples.coldVerified,
    ...(samples.coldVerified ? {} : { coldGateReason: COLD_GATE_UNVERIFIED_REASON }),
    warmInitializeP95Ms,
    warmToolsListP95Ms,
  };
}

type ProbeOptions = {
  mcpUrl: string;
  accessToken: string;
  warmSamples?: number;
  coldVerified?: boolean;
  fetchImpl?: typeof fetch;
  now?: () => number;
  phase2Samples?: number;
};

async function timedTool(input: {
  mcpUrl: string; accessToken: string; id: number; name: string;
  arguments: Record<string, unknown>; label: string; fetchImpl: typeof fetch; now: () => number;
}): Promise<number> {
  const start = input.now();
  let response: Response;
  try {
    response = await input.fetchImpl(input.mcpUrl, {
      method: 'POST',
      headers: { accept: 'application/json, text/event-stream',
        authorization: `Bearer ${input.accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: input.id, method: 'tools/call',
        params: { name: input.name, arguments: input.arguments } }),
    });
  } catch { throw new Error(`${input.label} request failed.`); }
  if (!response.ok) throw new Error(`${input.label} failed with HTTP ${response.status}.`);
  try {
    const message = await response.json() as Record<string, unknown>;
    const result = message.result as Record<string, unknown> | undefined;
    const structured = result?.structuredContent as Record<string, unknown> | undefined;
    if (message.jsonrpc !== '2.0' || message.id !== input.id || message.error ||
        result?.isError === true || !structured || structured.ok === false) throw new Error();
    if (input.name === 'semantic_search' && structured.searchMode !== 'semantic' &&
        structured.searchMode !== 'text_fuzzy') throw new Error();
  } catch { throw new Error(`${input.label} returned an invalid MCP response.`); }
  return input.now() - start;
}

async function timedRpc(input: {
  mcpUrl: string;
  accessToken: string;
  id: number;
  method: 'initialize' | 'tools/list';
  label: string;
  fetchImpl: typeof fetch;
  now: () => number;
}): Promise<number> {
  const start = input.now();
  let response: Response;
  try {
    response = await input.fetchImpl(input.mcpUrl, {
      method: 'POST',
      headers: {
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${input.accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: input.id,
        method: input.method,
        params: input.method === 'initialize'
          ? {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: { name: 'keco-mcp-performance-probe', version: '1' },
          }
          : {},
      }),
    });
  } catch {
    throw new Error(`${input.label} request failed.`);
  }
  if (!response.ok) {
    throw new Error(`${input.label} failed with HTTP ${response.status}.`);
  }
  try {
    const message = await response.json() as Record<string, unknown>;
    if (
      message.jsonrpc !== '2.0' ||
      message.id !== input.id ||
      !Object.hasOwn(message, 'result') ||
      Object.hasOwn(message, 'error')
    ) {
      throw new Error();
    }
  } catch {
    throw new Error(`${input.label} returned an invalid MCP response.`);
  }
  return input.now() - start;
}

export async function runPerformanceProbe(options: ProbeOptions) {
  if (!options.accessToken) throw new Error('MCP_ACCESS_TOKEN is required.');
  const warmSamples = options.warmSamples ?? DEFAULT_WARM_SAMPLES;
  if (!Number.isInteger(warmSamples) || warmSamples < 1 || warmSamples > 100) {
    throw new Error('Warm sample count must be an integer from 1 to 100.');
  }
  const phase2Samples = options.phase2Samples ?? 0;
  if (!Number.isInteger(phase2Samples) || phase2Samples < 0 || phase2Samples > 20) {
    throw new Error('Phase 2 sample count must be an integer from 0 to 20.');
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => performance.now());
  let id = 1;
  const invoke = (method: 'initialize' | 'tools/list', label: string) => timedRpc({
    mcpUrl: options.mcpUrl,
    accessToken: options.accessToken,
    id: id++,
    method,
    label,
    fetchImpl,
    now,
  });

  const firstRequestMs = await invoke('initialize', 'First request');
  const warmInitializeMs: number[] = [];
  const warmToolsListMs: number[] = [];
  for (let index = 0; index < warmSamples; index += 1) {
    warmInitializeMs.push(await invoke('initialize', 'Warm initialize'));
  }
  const accountEndpoint = isAccountEndpoint(options.mcpUrl);
  const phase2 = { projectList: [] as number[], read: [] as number[], structure: [] as number[], search: [] as number[] };
  for (let index = 0; index < phase2Samples; index += 1) {
    if (accountEndpoint) {
      phase2.projectList.push(await timedTool({ mcpUrl: options.mcpUrl, accessToken: options.accessToken,
        id: id++, name: 'list_projects', arguments: { limit: 100 }, label: 'Account project list',
        fetchImpl, now }));
      continue;
    }
    phase2.read.push(await timedTool({ mcpUrl: options.mcpUrl, accessToken: options.accessToken,
      id: id++, name: 'list_documents', arguments: { limit: 50 }, label: 'Phase 2 read',
      fetchImpl, now }));
    phase2.structure.push(await timedTool({ mcpUrl: options.mcpUrl, accessToken: options.accessToken,
      id: id++, name: 'list_project_structure', arguments: {}, label: 'Phase 2 structure',
      fetchImpl, now }));
    phase2.search.push(await timedTool({ mcpUrl: options.mcpUrl, accessToken: options.accessToken,
      id: id++, name: 'semantic_search', arguments: { query: `performance sample ${index}`, limit: 10 },
      label: 'Phase 2 search', fetchImpl, now }));
  }
  for (let index = 0; index < warmSamples; index += 1) {
    warmToolsListMs.push(await invoke('tools/list', 'Warm tools/list'));
  }

  const evaluation = evaluatePerformance({
    firstRequestMs,
    coldVerified: options.coldVerified === true,
    warmInitializeMs,
    warmToolsListMs,
  });
  if (!evaluation.coldVerified) {
    throw new Error(COLD_GATE_UNVERIFIED_REASON);
  }
  if (!evaluation.passed) throw new Error('MCP performance budgets failed.');
  const phase2Measurements = phase2Samples > 0
    ? accountEndpoint
      ? { accountProjectList: { sampleCount: phase2.projectList.length,
        p95Ms: percentile95(phase2.projectList), budgetMs: READ_LIMIT_MS } }
      : {
        ordinaryRead: { sampleCount: phase2.read.length, p95Ms: percentile95(phase2.read),
          budgetMs: READ_LIMIT_MS },
        projectStructure: { sampleCount: phase2.structure.length, p95Ms: percentile95(phase2.structure),
          budgetMs: STRUCTURE_LIMIT_MS },
        search: { sampleCount: phase2.search.length, p95Ms: percentile95(phase2.search),
          budgetMs: SEARCH_LIMIT_MS },
      }
    : null;
  if (phase2Measurements && (accountEndpoint
      ? phase2Measurements.accountProjectList.p95Ms >= READ_LIMIT_MS
      : phase2Measurements.ordinaryRead.p95Ms >= READ_LIMIT_MS ||
        phase2Measurements.projectStructure.p95Ms >= STRUCTURE_LIMIT_MS ||
        phase2Measurements.search.p95Ms >= SEARCH_LIMIT_MS)) {
    throw new Error('MCP Phase 2 performance budgets failed.');
  }

  return {
    checkedAt: new Date().toISOString(),
    passed: true,
    thresholdsMs: { coldRequest: COLD_LIMIT_MS, warmP95: WARM_LIMIT_MS },
    measurements: {
      firstRequestMs: evaluation.firstRequestMs,
      coldVerified: evaluation.coldVerified,
      warmInitialize: {
        sampleCount: warmInitializeMs.length,
        p95Ms: evaluation.warmInitializeP95Ms,
      },
      warmToolsList: {
        sampleCount: warmToolsListMs.length,
        p95Ms: evaluation.warmToolsListP95Ms,
      },
      phase2: phase2Measurements,
    },
  };
}

function requiredArgument(args: readonly string[], name: string): string {
  const index = args.indexOf(name);
  const value = args[index + 1];
  if (index < 0 || !value || value.startsWith('--')) throw new Error(`Missing ${name}.`);
  return value;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const output = requiredArgument(args, '--output');
  await replaceEvidenceAtomically(output, () => {
    const mcpUrl = requiredArgument(args, '--mcp-url');
    const token = process.env.MCP_ACCESS_TOKEN;
    if (!token) throw new Error('MCP_ACCESS_TOKEN is required.');
    return runPerformanceProbe({
      mcpUrl,
      accessToken: token,
      coldVerified: args.includes('--cold-verified'),
      phase2Samples: args.includes('--phase-2') ? DEFAULT_PHASE_2_SAMPLES : 0,
    });
  });
}

if (process.argv[1]?.endsWith('probe-mcp-performance.ts')) {
  void main().catch((error: unknown) => {
    const reason = error instanceof Error && error.message === COLD_GATE_UNVERIFIED_REASON
      ? COLD_GATE_UNVERIFIED_REASON
      : 'MCP performance probe failed.';
    console.error(reason);
    process.exitCode = 1;
  });
}
