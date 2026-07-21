import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const workflow = readFileSync(path.join(repoRoot, '.github/workflows/ci.yml'), 'utf8');
const deployWorkflow = readFileSync(
  path.join(repoRoot, '.github/workflows/deploy-vercel.yml'),
  'utf8'
);
const playwrightWorkflow = readFileSync(
  path.join(repoRoot, '.github/workflows/playwright.yml'),
  'utf8'
);

function getWorkflowJob(
  source: string,
  jobName: string,
  nextJobName?: string
): string {
  const startMarker = `\n  ${jobName}:\n`;
  const start = source.indexOf(startMarker);
  if (start === -1) {
    throw new Error(`Workflow job not found: ${jobName}`);
  }

  if (!nextJobName) {
    return source.slice(start);
  }

  const end = source.indexOf(`\n  ${nextJobName}:\n`, start + startMarker.length);
  if (end === -1) {
    throw new Error(`Workflow job not found: ${nextJobName}`);
  }

  return source.slice(start, end);
}

const checkMigrationsJob = getWorkflowJob(
  deployWorkflow,
  'check-migrations',
  'migrate-database'
);
const migrateDatabaseJob = getWorkflowJob(
  deployWorkflow,
  'migrate-database',
  'deploy'
);
const deployJob = getWorkflowJob(deployWorkflow, 'deploy');
const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
};

describe('CI workflow gates', () => {
  it('runs lint, unit tests, and build in CI', () => {
    expect(workflow).toContain('npm run lint');
    expect(workflow).toContain('npm run typecheck:api');
    expect(workflow).toContain('npm run test:unit');
    expect(workflow).toContain('npm run build');
  });

  it('keeps local validate aligned with CI gates', () => {
    expect(pkg.scripts.typecheck).toBe('tsc --noEmit');
    expect(pkg.scripts['typecheck:api']).toBe('tsc --noEmit -p tsconfig.api.json');
    expect(pkg.scripts.validate).toBe(
      'npm run lint && npm run typecheck && npm run typecheck:api && npm run check:mcp && npm run test:mcp && npm run test:unit && npm run build'
    );
  });

  it('runs Edge MCP checks in CI and local validate', () => {
    expect(workflow).toContain('npm run check:mcp');
    expect(workflow).toContain('npm run test:mcp');
    const apiTypecheck = workflow.indexOf('npm run typecheck:api');
    const mcpCheck = workflow.indexOf('npm run check:mcp');
    const mcpTest = workflow.indexOf('npm run test:mcp');
    const unitTest = workflow.indexOf('npm run test:unit');
    expect(apiTypecheck).toBeLessThan(mcpCheck);
    expect(mcpCheck).toBeLessThan(mcpTest);
    expect(mcpTest).toBeLessThan(unitTest);
  });

  it('does not force unit tests to run serially', () => {
    // The unit suite is pure (no shared live DB / global mutable state), so
    // --runInBand only serializes work Jest can parallelize. Keep it off so CI
    // wall time scales with the worker pool, not the sum of suite times.
    expect(workflow).not.toContain('--runInBand');
    expect(pkg.scripts.validate).not.toContain('--runInBand');
  });

  it('uses the ESLint CLI instead of the removed Next lint command', () => {
    expect(pkg.scripts.lint).toMatch(/^eslint \./);
    expect(pkg.scripts.lint).not.toContain('next lint');
  });

  it('pins the Deno MCP verification commands', () => {
    expect(pkg.scripts['check:mcp']).toBe(
      'deno check --config supabase/functions/mcp/deno.json supabase/functions/mcp/index.ts'
    );
    expect(pkg.scripts['test:mcp']).toBe(
      'deno test --config supabase/functions/mcp/deno.json --allow-env --allow-net supabase/functions/mcp'
    );
    expect(pkg.scripts['probe:mcp-performance']).toBe(
      'tsx scripts/probe-mcp-performance.ts'
    );
  });

  it('pins Supabase CLI versions instead of resolving latest during CI', () => {
    expect(workflow).toContain('version: 2.90.0');
    expect(deployWorkflow).toContain('version: 2.90.0');
    expect(workflow).not.toContain('version: latest');
    expect(deployWorkflow).not.toContain('version: latest');
  });

  it('isolates Supabase ports for every Playwright shard', () => {
    expect(playwrightWorkflow).toContain('supabaseApiPort:');
    expect(playwrightWorkflow).toContain('supabaseDbPort:');
    expect(playwrightWorkflow).toContain('Configure isolated Supabase ports');
    expect(playwrightWorkflow).toContain(
      'NEXT_PUBLIC_SUPABASE_URL: http://127.0.0.1:${{ matrix.supabaseApiPort }}'
    );
    expect(playwrightWorkflow).not.toContain(
      'curl -f -s http://127.0.0.1:54321/rest/v1/'
    );
  });

  it('does not deploy migrations for a PR with no migration diff', () => {
    expect(checkMigrationsJob).toContain(
      'BASE_COMMIT="${{ github.event.pull_request.base.sha }}"'
    );
    expect(checkMigrationsJob).toContain(
      'MIGRATION_FILES=$(bash scripts/detect-migration-changes.sh "$BASE_COMMIT")'
    );
    expect(checkMigrationsJob).not.toContain(
      'git diff --name-only "$BASE_BRANCH" HEAD | grep "^supabase/migrations/" || true'
    );
    expect(checkMigrationsJob).toContain(
      'echo "has-migrations=true" >> $GITHUB_OUTPUT'
    );
    expect(checkMigrationsJob).toContain(
      'echo "has-migrations=false" >> $GITHUB_OUTPUT'
    );
    expect(checkMigrationsJob).not.toContain(
      'Migration files detected (no changes, but unapplied migrations may exist)'
    );
    expect(migrateDatabaseJob).toContain("github.ref == 'refs/heads/main'");
    expect(migrateDatabaseJob).toContain("github.ref == 'refs/heads/master'");
    expect(migrateDatabaseJob).toContain(
      "startsWith(github.ref, 'refs/heads/release/')"
    );
    expect(migrateDatabaseJob).toContain('supabase db push --include-all');
    expect(migrateDatabaseJob).toContain('continue-on-error: false');
    expect(deployJob).toContain(
      "needs.check-migrations.result == 'success'"
    );
    expect(deployJob).toContain("needs.migrate-database.result == 'skipped'");
  });
});
