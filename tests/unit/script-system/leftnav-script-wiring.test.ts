import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const read = (file: string) =>
  readFileSync(path.join(process.cwd(), file), 'utf8');

describe('Keco Script LeftNav wiring', () => {
  it('isScriptSystemPath matches /script-system prefix', async () => {
    const { isScriptSystemPath } = await import(
      '@/lib/script-system/isScriptSystemPath'
    );
    expect(isScriptSystemPath('/script-system')).toBe(true);
    expect(isScriptSystemPath('/script-system/abc')).toBe(true);
    expect(isScriptSystemPath('/simulation-system')).toBe(false);
    expect(isScriptSystemPath('/proj/doc/x')).toBe(false);
  });

  it('LeftNav includes Script control between Simulation and coming-soon', () => {
    const source = read('src/components/layout/LeftNav.tsx');
    expect(source).toContain("aria-label=\"Script\"");
    expect(source).toContain('/script-system');
    const sim = source.indexOf("aria-label=\"Simulation\"");
    const script = source.indexOf("aria-label=\"Script\"");
    const soon = source.indexOf("aria-label=\"Coming soon\"");
    expect(sim).toBeGreaterThan(-1);
    expect(script).toBeGreaterThan(sim);
    expect(soon).toBeGreaterThan(script);
  });

  it('Studio active excludes script-system paths', () => {
    const source = read('src/components/layout/LeftNav.tsx');
    expect(source).toMatch(/!onSimulation\s*&&\s*!onScript|!onScript\s*&&\s*!onSimulation/);
  });

  it('DashboardLayout hides Studio sidebar and ChatPanel on script-system', () => {
    const source = read('src/components/layout/DashboardLayout.tsx');
    expect(source).toContain('isScriptSystemPath');
    expect(source).toMatch(/hideSidebarForSimulation|hideStudioChrome/);
  });

  it('routeParams lists script-system as special segment', () => {
    const source = read('src/lib/utils/routeParams.ts');
    expect(source).toContain("'script-system'");
  });
});
