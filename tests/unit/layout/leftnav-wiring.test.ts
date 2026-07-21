import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const read = (file: string) => readFileSync(path.join(process.cwd(), file), 'utf8');

describe('native simulation route', () => {
  it('mounts the native workbench providers without an iframe', () => {
    const source = read('src/app/(dashboard)/simulation-system/SimulationWorkbenchPage.tsx');
    expect(source).toContain('SimulationProjectProvider');
    expect(source).toContain('SimulationSessionProvider');
    expect(source).toContain('SimulationWorkbench');
    expect(source).not.toContain('iframe');
  });

  it('routes catch-all simulation segments to the native page', () => {
    const source = read('src/app/(dashboard)/simulation-system/[[...segments]]/page.tsx');
    expect(source).toContain('SimulationWorkbenchPage');
    expect(source).not.toContain('SimulationSystemEmbed');
  });
});

describe('leftNavStorage', () => {
  it('round-trips collapsed flag', async () => {
    const store = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', { value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    }, configurable: true });
    const { LEFTNAV_COLLAPSED_KEY, readLeftNavCollapsed, writeLeftNavCollapsed } = await import('@/components/layout/leftNavStorage');
    expect(LEFTNAV_COLLAPSED_KEY).toBe('keco.leftnav.collapsed');
    expect(readLeftNavCollapsed()).toBe(false);
    writeLeftNavCollapsed(true);
    expect(readLeftNavCollapsed()).toBe(true);
  });
});

describe('LeftNav wiring', () => {
  it('exports product navigation and collapse behavior', () => {
    const source = read('src/components/layout/LeftNav.tsx');
    expect(source).toContain('export function LeftNav');
    expect(source).toContain('/simulation-system');
    expect(source).toContain('/projects');
    expect(source).toContain('readLeftNavCollapsed');
  });

  it('always mounts LeftNav while simulation hides Studio resource chrome', () => {
    const source = read('src/components/layout/DashboardLayout.tsx');
    expect(source).toContain("import { LeftNav } from './LeftNav'");
    expect(source).toContain('<LeftNav');
    expect(source).toContain("pathname?.startsWith('/simulation-system')");
    expect(source).not.toContain('SimulationOriginWarmup');
    expect(source).not.toContain('isSimulationEmbedConfigured');
  });
});
