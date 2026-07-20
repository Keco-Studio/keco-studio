import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const read = (file: string) =>
  readFileSync(path.join(process.cwd(), file), 'utf8');

describe('simulation embed src (LeftNav / demo)', () => {
  it('buildSimulationEmbedSrc returns origin root only when no context', async () => {
    const { buildSimulationEmbedSrc } = await import(
      '@/lib/simulationEmbedSrc'
    );
    expect(buildSimulationEmbedSrc('http://localhost:5173')).toBe(
      'http://localhost:5173/'
    );
    expect(buildSimulationEmbedSrc('http://localhost:5173/')).toBe(
      'http://localhost:5173/'
    );
  });

  it('buildSimulationEmbedSrc appends studio project query params', async () => {
    const { buildSimulationEmbedSrc } = await import(
      '@/lib/simulationEmbedSrc'
    );
    const src = buildSimulationEmbedSrc('http://localhost:5173', {
      projectId: 'proj-1',
      projectName: '11',
      projects: [{ id: 'proj-1', name: '11' }, { id: 'proj-2', name: 'KK农场' }],
    });
    const url = new URL(src);
    expect(url.origin).toBe('http://localhost:5173');
    expect(url.searchParams.get('projectId')).toBe('proj-1');
    expect(url.searchParams.get('projectName')).toBe('11');
    expect(JSON.parse(decodeURIComponent(url.searchParams.get('projects') || '[]'))).toEqual([
      { id: 'proj-1', name: '11' },
      { id: 'proj-2', name: 'KK农场' },
    ]);
  });

  it('SimulationSystemEmbed uses buildSimulationEmbedSrc and does not append pathname', () => {
    const source = read(
      'src/app/(dashboard)/simulation-system/SimulationSystemEmbed.tsx'
    );
    expect(source).toContain('buildSimulationEmbedSrc');
    expect(source).not.toContain('`${origin}${pathname}${suffix}`');
    expect(source).toContain('localhost:5173');
  });
});

describe('leftNavStorage', () => {
  it('round-trips collapsed flag', async () => {
    const store = new Map<string, string>();
    const ls = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
    };
    Object.defineProperty(globalThis, 'localStorage', {
      value: ls,
      configurable: true,
    });

    const {
      LEFTNAV_COLLAPSED_KEY,
      readLeftNavCollapsed,
      writeLeftNavCollapsed,
    } = await import('@/components/layout/leftNavStorage');

    expect(LEFTNAV_COLLAPSED_KEY).toBe('keco.leftnav.collapsed');
    expect(readLeftNavCollapsed()).toBe(false);
    writeLeftNavCollapsed(true);
    expect(store.get(LEFTNAV_COLLAPSED_KEY)).toBe('1');
    expect(readLeftNavCollapsed()).toBe(true);
    writeLeftNavCollapsed(false);
    expect(readLeftNavCollapsed()).toBe(false);
  });
});

describe('LeftNav wiring', () => {
  it('exports LeftNav with studio + simulation routes and collapse key', () => {
    const source = read('src/components/layout/LeftNav.tsx');
    expect(source).toContain('export function LeftNav');
    expect(source).toContain("/simulation-system");
    expect(source).toContain('/projects');
    expect(source).toContain('readLeftNavCollapsed');
    expect(source).toContain('aria-disabled');
  });

  it('defines rail visual tokens in CSS module', () => {
    const css = read('src/components/layout/LeftNav.module.css');
    expect(css).toContain('#FAFAFA');
    expect(css).toMatch(/60(?:\.5)?px/);
    expect(css).toContain('rgba(17, 17, 17, 0.2)');
  });
});

describe('DashboardLayout LeftNav mount', () => {
  it('always mounts LeftNav and keeps simulation hide only for Sidebar/TopBar', () => {
    const source = read('src/components/layout/DashboardLayout.tsx');
    expect(source).toContain("import { LeftNav } from './LeftNav'");
    expect(source).toContain('<LeftNav');
    expect(source).toMatch(
      /<LeftNav[\s\S]*\{!hideSidebarForSimulation \? \([\s\S]*<Sidebar/
    );
  });
});
