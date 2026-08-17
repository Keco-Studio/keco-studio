import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const routeSuites = readdirSync(join(process.cwd(), 'tests/unit'))
  .filter((name) => /^game-design-system.*route.*\.test\.ts$/.test(name))
  .filter((name) => name !== 'game-design-system-route-test-boundaries.test.ts')
  .map((name) => `tests/unit/${name}`);

describe('Game Design System route test boundaries', () => {
  it.each(routeSuites)('%s does not replace authentication or Supabase state', (relativePath) => {
    const source = readFileSync(join(process.cwd(), relativePath), 'utf8');

    expect(source).not.toContain("jest.mock('@/lib/auth/route-auth'");
    expect(source).not.toMatch(/const\s+(mockSupabase|authSupabase|serviceSupabase)\s*=/);
  });
});
