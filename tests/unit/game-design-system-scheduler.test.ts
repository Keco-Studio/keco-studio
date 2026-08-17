import { describe, expect, it } from '@jest/globals';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const repositoryRoot = process.cwd();
const schedulerPath = join(repositoryRoot, '.github/workflows/game-design-system-worker.yml');

function readScheduler(): string {
  // Keep the contract failure actionable when the workflow has not been restored yet.
  return existsSync(schedulerPath) ? readFileSync(schedulerPath, 'utf8') : '';
}

describe('Game Design System durable worker scheduling contract', () => {
  it('uses a Hobby-compatible GitHub Actions schedule with a manual trigger', () => {
    const scheduler = readScheduler();

    expect(scheduler).toContain('workflow_dispatch:');
    expect(scheduler).toMatch(/cron:\s*["']?\*\/5 \* \* \* \*["']?/);
    expect(scheduler).toMatch(/cancel-in-progress:\s*false/);
  });

  it('invokes the production worker with the dedicated bearer secret', () => {
    const scheduler = readScheduler();

    expect(scheduler).toContain('WORKER_SECRET: ${{ secrets.GAME_DESIGN_SYSTEM_WORKER_SECRET }}');
    expect(scheduler).toContain('Authorization: Bearer $WORKER_SECRET');
    expect(scheduler).toContain('https://keco-studio-main.vercel.app/api/internal/game-design-system-worker');
  });

  it('syncs the worker secret to production Vercel as CRON_SECRET', () => {
    const deployWorkflow = readFileSync(join(repositoryRoot, '.github/workflows/deploy-vercel.yml'), 'utf8');

    expect(deployWorkflow).toContain('GAME_DESIGN_SYSTEM_WORKER_SECRET');
    expect(deployWorkflow).toMatch(/vercel env add CRON_SECRET production --force/);
  });

  it('does not declare Vercel Cron jobs', () => {
    const vercelConfig = JSON.parse(readFileSync(join(repositoryRoot, 'vercel.json'), 'utf8')) as Record<string, unknown>;

    expect(vercelConfig).not.toHaveProperty('crons');
  });
});
