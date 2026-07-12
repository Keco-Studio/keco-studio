import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveStoryPlanForImport } from '@/lib/story-plan/conversion';

interface ProbeArguments {
  fixturePath: string;
  runs: number;
}

interface ProbeResult {
  run: number;
  elapsedMs: number;
  attempts: number;
  nodeCount: number;
  auditVerdict: 'pass' | 'fail';
  labels: string[];
  targets: string[];
  commands: string[];
}

const DEFAULT_FIXTURE = 'tests/fixtures/import-script/nested-trust-story.txt';

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2));
  const source = await fs.readFile(path.resolve(process.cwd(), args.fixturePath), 'utf8');
  let failed = false;

  for (let run = 1; run <= args.runs; run += 1) {
    const startedAt = performance.now();
    try {
      const resolved = await resolveStoryPlanForImport(source, {
        sourceId: 'probe',
      });
      const result = summarizeSuccess(run, performance.now() - startedAt, resolved);
      if (result.auditVerdict !== 'pass') failed = true;
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } catch {
      failed = true;
      process.stdout.write(`${JSON.stringify(summarizeFailure(run, performance.now() - startedAt))}\n`);
    }
  }

  if (failed) process.exitCode = 1;
}

function parseArguments(argv: string[]): ProbeArguments {
  let fixturePath = DEFAULT_FIXTURE;
  let runs = 1;

  for (const argument of argv) {
    if (argument.startsWith('--runs=')) {
      runs = Number(argument.slice('--runs='.length));
      continue;
    }
    if (argument.startsWith('--')) throw new Error('Unsupported probe argument');
    fixturePath = argument;
  }

  if (!Number.isSafeInteger(runs) || runs < 1 || runs > 20) {
    throw new Error('Probe runs must be an integer from 1 to 20');
  }
  return { fixturePath, runs };
}

function summarizeSuccess(
  run: number,
  elapsedMs: number,
  resolved: Awaited<ReturnType<typeof resolveStoryPlanForImport>>
): ProbeResult {
  const targets = new Set<string>();
  const commands: string[] = [];
  for (const row of resolved.projection.rows) {
    if (row.nextNodeId) targets.add(row.nextNodeId);
    row.commands.forEach((command) => commands.push(command));
    for (const choice of row.choices) {
      targets.add(choice.targetNodeId);
      choice.commands.forEach((command) => commands.push(command));
    }
  }

  return {
    run,
    elapsedMs: Math.round(elapsedMs),
    attempts: resolved.attempts,
    nodeCount: resolved.document.nodes.length,
    auditVerdict: resolved.audit.verdict,
    labels: resolved.document.nodes.map((node) => node.label),
    targets: [...targets],
    commands,
  };
}

function summarizeFailure(run: number, elapsedMs: number): ProbeResult {
  return {
    run,
    elapsedMs: Math.round(elapsedMs),
    attempts: 0,
    nodeCount: 0,
    auditVerdict: 'fail',
    labels: [],
    targets: [],
    commands: [],
  };
}

void main().catch(() => {
  process.exitCode = 1;
});
