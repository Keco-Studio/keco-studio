import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

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
    expect(config).not.toContain('override: true');
    expect(existsSync(wrapperPath)).toBe(true);
    const wrapper = existsSync(wrapperPath) ? readFileSync(wrapperPath, 'utf8') : '';
    expect(wrapper).toContain("'next-env.d.ts'");
    expect(wrapper).toContain("'tsconfig.json'");
    expect(wrapper).toContain('GAME_DESIGN_SYSTEM_LLM_API_URL');
    expect(wrapper).toContain('You create reusable Game Design Systems for Keco Studio.');
    expect(wrapper).toMatch(/writeFileSync/);
    expect(wrapper).toMatch(/SIGTERM/);
    expect(nextEnv).toMatch(/import "\.\/\.next\/(?:dev\/)?types\/routes\.d\.ts";/);
    expect(nextEnv).not.toContain('.next-playwright');
    expect(tsconfig).not.toContain('.next-playwright');
  });

  it('starts the local MCP server without requiring an untracked env file', () => {
    const wrapperPath = join(process.cwd(), 'scripts/run-playwright-mcp-server.mjs');
    const wrapper = readFileSync(wrapperPath, 'utf8');

    expect(wrapper).toContain("existsSync(path.join(rootDir, '.env.local'))");
    expect(wrapper).toContain("...envFileArgs");
    expect(wrapper).toContain('startRuntimeWithRetry({');
    expect(wrapper).not.toContain(
      "['functions', 'serve', 'mcp', '--env-file', '.env.local']"
    );
  });

  it('retries once when the MCP Edge runtime exits before becoming ready', () => {
    const runtimeUrl = pathToFileURL(
      join(process.cwd(), 'scripts/playwright-mcp-runtime.mjs')
    ).href;
    const scenario = `
      import { EventEmitter } from 'node:events';
      import { startRuntimeWithRetry } from ${JSON.stringify(runtimeUrl)};

      let attempts = 0;
      let stops = 0;
      const children = [];
      const result = await startRuntimeWithRetry({
        spawnRuntime() {
          attempts += 1;
          const child = new EventEmitter();
          child.kill = () => {};
          children.push(child);
          if (attempts === 1) {
            queueMicrotask(() => child.emit('exit', 135, null));
          }
          return child;
        },
        stopRuntime() {
          stops += 1;
        },
        probeReady: async () => attempts === 2,
        sleep: async () => {},
        timeoutMs: 1_000,
        retryDelayMs: 0,
        log: () => {},
      });

      console.log(JSON.stringify({
        attempts,
        stops,
        returnedSecondChild: result.child === children[1],
      }));
    `;

    const result = spawnSync(
      process.execPath,
      ['--input-type=module', '--eval', scenario],
      { encoding: 'utf8' },
    );

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toEqual({
      attempts: 2,
      stops: 1,
      returnedSecondChild: true,
    });
  });
});
