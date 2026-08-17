import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Playwright Next.js isolation', () => {
  it('restores Next-generated tracked TypeScript files after an isolated server run', () => {
    const root = process.cwd();
    const config = readFileSync(join(root, 'playwright.config.ts'), 'utf8');
    const wrapperPath = join(root, 'scripts/run-playwright-dev-server.mjs');
    const nextEnv = readFileSync(join(root, 'next-env.d.ts'), 'utf8');
    const tsconfig = readFileSync(join(root, 'tsconfig.json'), 'utf8');

    expect(config).toContain('node scripts/run-playwright-dev-server.mjs');
    expect(config).toContain("gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 }");
    expect(config).toContain('PLAYWRIGHT_SUPABASE_SERVICE_ROLE_KEY');
    expect(existsSync(wrapperPath)).toBe(true);
    const wrapper = existsSync(wrapperPath) ? readFileSync(wrapperPath, 'utf8') : '';
    expect(wrapper).toContain("'next-env.d.ts'");
    expect(wrapper).toContain("'tsconfig.json'");
    expect(wrapper).toContain('GAME_DESIGN_SYSTEM_LLM_API_URL');
    expect(wrapper).toContain('You create reusable Game Design Systems for Keco Studio.');
    expect(wrapper).toMatch(/writeFileSync/);
    expect(wrapper).toMatch(/SIGTERM/);
    expect(nextEnv).toContain('import "./.next/types/routes.d.ts";');
    expect(nextEnv).not.toContain('.next-playwright');
    expect(tsconfig).not.toContain('.next-playwright');
  });
});
