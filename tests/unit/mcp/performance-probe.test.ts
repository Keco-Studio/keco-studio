import { describe, expect, it, jest } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  evaluatePerformance,
  percentile95,
  runPerformanceProbe,
} from '../../../scripts/probe-mcp-performance';

const mcpUrl = 'https://abc.supabase.co/functions/v1/mcp/11111111-1111-4111-8111-111111111111';

function rpcResponse(id: number): Response {
  return Response.json({ jsonrpc: '2.0', id, result: {} });
}

describe('MCP performance probe', () => {
  it('removes stale PASS evidence when MCP_ACCESS_TOKEN is missing', () => {
    const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'keco-performance-probe-'));
    const output = path.join(fixtureRoot, 'evidence.json');
    const { MCP_ACCESS_TOKEN: _token, ...envWithoutToken } = process.env;

    try {
      writeFileSync(output, '{"passed":true,"stale":true}\n', 'utf8');
      const result = spawnSync(process.execPath, [
        '--import', 'tsx',
        'scripts/probe-mcp-performance.ts',
        '--mcp-url', mcpUrl,
        '--output', output,
      ], {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: envWithoutToken,
      });

      expect(result.status).toBe(1);
      expect(result.stderr.trim()).toBe('MCP performance probe failed.');
      expect(existsSync(output)).toBe(false);
      expect(readdirSync(fixtureRoot)).toEqual([]);
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it('makes latency evidence mandatory in the Phase 1 plan and client matrix', () => {
    const plan = readFileSync(path.join(
      process.cwd(),
      'docs/superpowers/plans/2026-07-21-supabase-mcp-phase-1.md'
    ), 'utf8');
    expect(plan).toContain('npm run probe:mcp-performance');
    expect(plan).toContain('cold request latency');
    expect(plan).toContain('warm `initialize` P95');
    expect(plan).toContain('warm `tools/list` P95');
    expect(plan).toContain('performance evidence reports `"passed": true`');
    expect(plan).toContain('cold request latency, warm `initialize` P95, and warm `tools/list` P95');
  });

  it('uses nearest-rank P95 without mutating samples', () => {
    const samples = [100, 5, 95, 10, 90, 15, 85, 20, 80, 25, 75, 30, 70, 35, 65, 40, 60, 45, 55, 50];
    expect(percentile95(samples)).toBe(95);
    expect(samples[0]).toBe(100);
  });

  it('enforces strict cold and warm latency thresholds', () => {
    expect(evaluatePerformance({
      coldInitializeMs: 1999.99,
      warmInitializeMs: [299.99],
      warmToolsListMs: [299.99],
    }).passed).toBe(true);
    expect(evaluatePerformance({
      coldInitializeMs: 2000,
      warmInitializeMs: [300],
      warmToolsListMs: [1],
    })).toEqual(expect.objectContaining({ passed: false }));
  });

  it('authenticates from the supplied token but never returns or logs it', async () => {
    const token = 'header.payload.signature';
    const fetchMock = jest.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${token}`);
      const request = JSON.parse(String(init?.body)) as { id: number };
      return rpcResponse(request.id);
    });
    const nowValues = [0, 1000, 1000, 1010, 1010, 1020, 1020, 1030, 1030, 1040];
    const now = () => nowValues.shift() ?? 1040;

    const evidence = await runPerformanceProbe({
      mcpUrl,
      accessToken: token,
      warmSamples: 2,
      fetchImpl: fetchMock as typeof fetch,
      now,
    });

    expect(evidence.passed).toBe(true);
    expect(JSON.stringify(evidence)).not.toContain(token);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('includes response body validation in request latency', async () => {
    let clock = 0;
    const fetchMock = jest.fn(async (_url: string | URL | Request, init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => {
        clock += 25;
        const request = JSON.parse(String(init?.body)) as { id: number };
        return { jsonrpc: '2.0', id: request.id, result: {} };
      },
    } as Response));

    const evidence = await runPerformanceProbe({
      mcpUrl,
      accessToken: 'header.payload.signature',
      warmSamples: 1,
      fetchImpl: fetchMock as typeof fetch,
      now: () => clock,
    });

    expect(evidence.measurements.coldInitializeMs).toBe(25);
    expect(evidence.measurements.warmInitialize.p95Ms).toBe(25);
    expect(evidence.measurements.warmToolsList.p95Ms).toBe(25);
  });

  it('fails with a stable error that does not include remote secret content', async () => {
    const token = 'header.payload.signature';
    const fetchMock = jest.fn(async () => new Response('access_token=remote-secret', { status: 500 }));

    await expect(runPerformanceProbe({
      mcpUrl,
      accessToken: token,
      warmSamples: 1,
      fetchImpl: fetchMock as typeof fetch,
      now: () => 0,
    })).rejects.toThrow('Cold initialize failed with HTTP 500.');
  });

  it('rejects JSON that is not the matching JSON-RPC response', async () => {
    const fetchMock = jest.fn(async () => Response.json({ ok: true }));

    await expect(runPerformanceProbe({
      mcpUrl,
      accessToken: 'header.payload.signature',
      warmSamples: 1,
      fetchImpl: fetchMock as typeof fetch,
      now: () => 0,
    })).rejects.toThrow('Cold initialize returned an invalid MCP response.');
  });
});
