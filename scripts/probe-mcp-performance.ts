import { replaceEvidenceAtomically } from './lib/atomic-evidence';

const COLD_LIMIT_MS = 2000;
const WARM_LIMIT_MS = 300;
const DEFAULT_WARM_SAMPLES = 20;
const PROTOCOL_VERSION = '2025-11-25';
const COLD_GATE_UNVERIFIED_REASON = 'cold-start-not-verified' as const;

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
};

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

  return {
    checkedAt: new Date().toISOString(),
    passed: true,
    mcpUrl: options.mcpUrl,
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
