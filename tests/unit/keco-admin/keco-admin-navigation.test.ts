import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  getProductNavigationDestination,
  getProductNavigationState,
} from '@/lib/create-map/productNavigation';
import {
  parseRouteParams,
  SPECIAL_ROUTE_SEGMENTS,
} from '@/lib/utils/routeParams';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('Keco Admin navigation', () => {
  it('treats the admin workspace as an account route', () => {
    expect(SPECIAL_ROUTE_SEGMENTS).toContain('keco-admin');
    expect(parseRouteParams('/keco-admin')).toEqual({
      projectId: null,
      libraryId: null,
      folderId: null,
      assetId: null,
      documentId: null,
      isPredefinePage: false,
      isLibraryPage: false,
    });
  });

  it('activates only the admin product and routes directly to it', () => {
    expect(getProductNavigationState('/keco-admin')).toEqual({
      studio: false,
      simulation: false,
      script: false,
      createMap: false,
      gameDesignSystem: false,
      keco101: false,
      kecoAdmin: true,
    });
    expect(
      getProductNavigationDestination('/projects', 'kecoAdmin'),
    ).toBe('/keco-admin');
    expect(
      getProductNavigationDestination('/keco-admin', 'kecoAdmin'),
    ).toBeNull();
  });

  it('keeps the avatar entry immediately above Logout', () => {
    const topBar = read('src/components/layout/TopBar.tsx');
    const menu = topBar.slice(topBar.indexOf('{showUserMenu &&'));

    expect(topBar).toContain('useKecoAdminAccess(userId)');
    expect(menu.indexOf('Keco Admin')).toBeGreaterThan(menu.indexOf('MCP'));
    expect(menu.indexOf('Keco Admin')).toBeLessThan(menu.indexOf('Logout'));
    expect(topBar).toContain("router.push('/keco-admin')");
  });

  it('keeps Admin out of LeftNav and only in the avatar menu', () => {
    const leftNav = read('src/components/layout/LeftNav.tsx');

    expect(leftNav).not.toContain('Keco Admin');
    expect(leftNav).not.toContain('useKecoAdminAccess');
    expect(leftNav).not.toContain('kecoAdmin');
  });

  it('uses one fail-closed cached capability query', () => {
    const hook = read('src/lib/hooks/useKecoAdminAccess.ts');

    expect(hook).toContain("queryKey: ['keco-admin-access', userId]");
    expect(hook).toContain('enabled: Boolean(userId)');
    expect(hook).toContain('staleTime: Infinity');
    expect(hook).toContain('retry: false');
    expect(hook).toContain("fetch('/api/keco-admin/access'");
    expect(hook).toContain("cache: 'no-store'");
    expect(hook).toContain('if (!response.ok) return false');
    expect(hook).toMatch(/catch\s*\{[\s\S]+return false/);
  });
});
