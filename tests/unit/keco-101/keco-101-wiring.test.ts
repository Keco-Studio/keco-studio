import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { isKeco101Path } from '@/lib/keco-101/isKeco101Path';
import {
  getProductNavigationDestination,
  getProductNavigationState,
} from '@/lib/create-map/productNavigation';
import { parseRouteParams, SPECIAL_ROUTE_SEGMENTS } from '@/lib/utils/routeParams';

const read = (file: string) => readFileSync(path.join(process.cwd(), file), 'utf8');

describe('Keco 101 route matching', () => {
  it('matches the guide route and its children only', () => {
    expect(isKeco101Path('/keco-101')).toBe(true);
    expect(isKeco101Path('/keco-101/welcome')).toBe(true);
    expect(isKeco101Path('/keco-1010')).toBe(false);
    expect(isKeco101Path('/create-map')).toBe(false);
    expect(isKeco101Path(null)).toBe(false);
  });
});

describe('Keco 101 product navigation', () => {
  it('treats /keco-101 as a product workspace, not a project id', () => {
    expect(SPECIAL_ROUTE_SEGMENTS).toContain('keco-101');
    expect(parseRouteParams('/keco-101').projectId).toBeNull();
    expect(parseRouteParams('/keco-101/welcome').projectId).toBeNull();
  });

  it('activates its own slot and releases Studio', () => {
    expect(getProductNavigationState('/keco-101')).toEqual({
      studio: false,
      simulation: false,
      script: false,
      createMap: false,
      gameDesignSystem: false,
      keco101: true,
    });
  });

  it('routes the guide slot to /keco-101 and stays put when already there', () => {
    expect(getProductNavigationDestination('/projects', 'keco101')).toBe('/keco-101');
    expect(getProductNavigationDestination('/keco-101', 'keco101')).toBeNull();
    expect(getProductNavigationDestination('/keco-101', 'studio')).toBe('/projects');
  });

  it('exposes the guide as the first product control', () => {
    const source = read('src/components/layout/LeftNav.tsx');
    expect(source).toContain('aria-label="Keco 101"');
    expect(source).toContain("navigate('keco101')");
    const keco101 = source.indexOf('aria-label="Keco 101"');
    const studio = source.indexOf('aria-label="Studio"');
    const gameDesignSystem = source.indexOf('aria-label="Game Design System"');
    expect(keco101).toBeGreaterThan(-1);
    expect(studio).toBeGreaterThan(keco101);
    expect(gameDesignSystem).toBeGreaterThan(studio);
  });
});

describe('Keco 101 page shell', () => {
  it('renders full bleed: no Studio sidebar, TopBar, or chat panel', () => {
    const source = read('src/components/layout/DashboardLayout.tsx');
    expect(source).toContain('isKeco101Path');
    expect(source).toMatch(/showStudioSidebar\s*=[\s\S]*?!onKeco101/);
    expect(source).toMatch(/hideChatPanel\s*=[\s\S]*?\|\|\s*onKeco101/);
    expect(source).toContain('showTopBar && !onKeco101');
  });

  it('keeps both sub-pages inside one page instead of splitting the sidebar', () => {
    const source = read('src/features/keco-101/Keco101Page.tsx');
    expect(source).toContain("id: 'welcome'");
    expect(source).toContain("id: 'getting-started'");
    expect(source).toContain('role="tablist"');
    expect(source).toContain('Keco101Welcome');
    expect(source).toContain('Keco101GettingStarted');
  });

  it('opens on a full-height welcome hero that scrolls into the guide', () => {
    const css = read('src/features/keco-101/Keco101.module.css');
    expect(css).toMatch(/\.hero\s*\{[\s\S]*?min-height:\s*100%/);
    expect(css).toMatch(/\.scroller\s*\{[\s\S]*?overflow-y:\s*auto/);
  });

  it('covers the six production stages and leaves visual placeholders', () => {
    const content = read('src/features/keco-101/keco101Content.ts');
    const guide = read('src/features/keco-101/Keco101GettingStarted.tsx');
    const stageIds = [...content.matchAll(/id: 'stage-([a-z]+)'/g)].map((match) => match[1]);
    expect(stageIds).toEqual(['design', 'data', 'art', 'slice', 'evaluate', 'iterate']);
    expect(content).toContain('placeholder:');
    expect(guide).toContain('styles.placeholder');
  });
});
