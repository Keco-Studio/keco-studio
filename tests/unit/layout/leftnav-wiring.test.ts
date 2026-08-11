import React from 'react';
import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  getProductNavigationDestination,
  getProductNavigationState,
} from '@/lib/create-map/productNavigation';

const read = (file: string) => readFileSync(path.join(process.cwd(), file), 'utf8');

jest.mock('next/navigation', () => ({
  usePathname: () => '/create-map',
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock('next/image', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => React.createElement('img', props),
}));

jest.mock('@/assets/images/simulator/align-center.svg', () => 'align-center');
jest.mock('@/assets/images/simulator/align-center-active.svg', () => 'align-center-active');
jest.mock('@/assets/images/simulator/archive.svg', () => 'archive');
jest.mock('@/assets/images/simulator/archive-active.svg', () => 'archive-active');
jest.mock('@/assets/images/simulator/ilightning.svg', () => 'lightning');
jest.mock('@/assets/images/simulator/lightning-active.svg', () => 'lightning-active');

jest.mock('@/components/layout/LeftNav.module.css', () => ({
  __esModule: true,
  default: new Proxy({}, { get: (_target, property) => String(property) }),
}));

import { LeftNav } from '@/components/layout/LeftNav';

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
  it('marks only the fourth product slot active for Create Map', () => {
    expect(getProductNavigationState('/create-map')).toEqual({
      studio: false,
      simulation: false,
      script: false,
      createMap: true,
    });
  });

  it('routes the fourth product slot to Create Map and returns Studio to projects', () => {
    expect(getProductNavigationDestination('/projects', 'createMap')).toBe('/create-map');
    expect(getProductNavigationDestination('/create-map', 'createMap')).toBeNull();
    expect(getProductNavigationDestination('/create-map', 'studio')).toBe('/projects');
  });

  it('renders Create Map as the fourth product control with the active page state', () => {
    const markup = renderToStaticMarkup(React.createElement(LeftNav));
    const controls = [...markup.matchAll(/aria-label="([^"]+)"/g)].map((match) => match[1]);

    expect(controls.slice(1, 6)).toEqual([
      'Studio',
      'Simulation',
      'Script',
      'Create Map',
      'Coming soon',
    ]);
    expect(markup).toContain('aria-label="Create Map" aria-current="page"');
  });

  it('keeps simulation navigation and collapse behavior', () => {
    const source = read('src/components/layout/LeftNav.tsx');
    expect(source).toContain('export function LeftNav');
    expect(source).toContain('readLeftNavCollapsed');
    expect(getProductNavigationDestination('/projects', 'simulation')).toBe('/simulation-system');
  });

  it('keeps the shared TopBar while simulation hides Studio resource chrome', () => {
    const source = read('src/components/layout/DashboardLayout.tsx');
    const topBarSource = read('src/components/layout/TopBar.tsx');
    const topBarCss = read('src/components/layout/TopBar.module.css');
    const simulationCss = read('src/components/simulation/workbench/SimulationWorkbench.module.css');
    expect(source).toContain("import { LeftNav } from './LeftNav'");
    expect(source).toContain("import { TopBar } from './TopBar'");
    expect(source).toContain('<LeftNav');
    expect(source).toContain('<TopBar');
    expect(source).toContain('data-simulation-sidebar-slot');
    expect(source).toContain('simulationSidebarSlot');
    expect(source).toContain("pathname?.startsWith('/simulation-system')");
    expect(source).not.toContain('hideTopBar');
    expect(source).not.toContain('SimulationOriginWarmup');
    expect(source).not.toContain('isSimulationEmbedConfigured');
    expect(topBarSource).toContain('onSimulationSystem');
    expect(topBarSource).toContain('if (onSimulationSystem)');
    expect(topBarSource).toContain('data-simulation-header-slot');
    expect(topBarSource).toContain('simulationHeaderSlot');
    expect(topBarCss).toContain('.headerSimulation .simulationHeaderSlot');
    expect(topBarCss).toMatch(/\.headerSimulation\s*\{[\s\S]*?display:\s*flex/);
    expect(topBarCss).toMatch(/\.headerSimulation\s+\.searchContainer\s*\{[\s\S]*?margin-left:\s*auto/);
    expect(topBarCss).toMatch(/\.headerSimulation\s+\.searchContainer\s*\{[\s\S]*?margin-right:\s*auto/);
    expect(topBarCss).toMatch(/\.headerSimulation\s+\.searchContainer\s*\{[\s\S]*?width:\s*33rem/);
    expect(topBarCss).toMatch(/\.headerSimulation\s+\.left\s*\{[\s\S]*?flex:\s*0\s+0\s+auto/);
    expect(topBarCss).toMatch(/\.headerSimulation\s+\.right\s*\{[\s\S]*?flex:\s*0\s+0\s+auto/);
    expect(topBarCss).toContain('--simulation-topbar-workflow-gap');
    expect(topBarCss).toContain('--simulation-topbar-workflow-button-size');
    expect(topBarCss).toContain('--simulation-topbar-workflow-active-color');
    expect(simulationCss).toContain('var(--simulation-topbar-workflow-gap');
    expect(simulationCss).toContain('var(--simulation-topbar-workflow-button-size');
    expect(simulationCss).toContain('var(--simulation-topbar-workflow-active-color');
    expect(topBarCss).toMatch(/\.headerSimulation\s+\.right[\s\S]*?gap:\s*12px/);
    // Opaque header: avoid frosted blur of editor tooltips over the breadcrumb.
    expect(topBarCss).toMatch(/\.header\s*\{[\s\S]*?background-color:\s*#ffffff/);
    expect(topBarCss).not.toMatch(/\.header\s*\{[\s\S]*?backdrop-filter:/);
  });

  it('scopes simulation global search to the remembered simulation project', () => {
    const source = read('src/components/layout/TopBar.tsx');
    expect(source).toContain('readSimulationProjectPreference');
    expect(source).toContain('simulationProjectId');
    expect(source).toMatch(
      /const\s+searchProjectId\s*=\s*onSimulationSystem\s*\?\s*simulationProjectId\s*:\s*currentProjectId/
    );
    expect(source).toMatch(
      /useSidebarFoldersLibraries\(\s*searchProjectId\s*,\s*\{[\s\S]*?excludeScriptLibraries:\s*!onScriptSystem[\s\S]*?\}\s*\)/
    );
    expect(source).toMatch(/addEventListener\(\s*['"]simulation-project-changed['"]/);
    expect(source).toMatch(/removeEventListener\(\s*['"]simulation-project-changed['"]/);
  });
});
