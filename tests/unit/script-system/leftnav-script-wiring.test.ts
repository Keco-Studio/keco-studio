import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { getCreateMapDashboardChrome } from '@/lib/create-map/dashboardChrome';
import { getProductNavigationState } from '@/lib/create-map/productNavigation';

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
    expect(getProductNavigationState('/script-system')).toEqual({
      studio: false,
      simulation: false,
      script: true,
      createMap: false,
      keco101: false,
    });
  });

  it('DashboardLayout mounts product sidebars beside the shared TopBar', () => {
    const source = read('src/components/layout/DashboardLayout.tsx');
    expect(source).toContain('isScriptSystemPath');
    expect(source).toContain('showStudioSidebar');
    expect(source).toContain('showScriptSidebar');
    expect(source).toContain('ScriptSidebar');
    expect(source).toContain('hideChatPanel');
    expect(source).toContain('<TopBar');
    expect(source).not.toContain('hideTopBar');
    expect(source).toMatch(/showScriptSidebar\s*=\s*onScriptSystem/);
    expect(getCreateMapDashboardChrome('/script-system').showChatPanel).toBe(true);
  });

  it('ScriptSidebar collapses on TopBar sidebar-toggle', () => {
    const source = read('src/components/script-system/ScriptSidebar.tsx');
    const css = read('src/components/script-system/ScriptSidebar.module.css');
    expect(source).toContain('sidebar-toggle');
    expect(source).toContain('isSidebarVisible');
    expect(source).toContain('sidebarHidden');
    expect(css).toMatch(/\.sidebarHidden/);
  });

  it('Script project picker matches the bordered select control used by Simulation', () => {
    const css = read('src/components/script-system/ScriptSidebar.module.css');
    expect(css).toMatch(/\.projectButton\s*\{[^}]*border:\s*1\.5px solid/s);
    expect(css).toMatch(/\.projectButton\s*\{[^}]*border-radius:\s*8px/s);
    expect(css).toMatch(/\.projectButton\s*\{[^}]*min-height:\s*36px/s);
  });

  it('Script delete uses the shared DeleteConfirmDialog like Studio libraries', () => {
    const sidebar = read('src/components/script-system/ScriptSidebar.tsx');
    const actions = read('src/components/script-system/useScriptSidebarActions.ts');
    expect(sidebar).toContain('DeleteConfirmDialog');
    expect(sidebar).toContain('requestDeleteConfirm');
    expect(actions).toContain('requestDeleteConfirm');
    expect(actions).toContain("content: 'Delete this script?'");
    expect(actions).toContain('Remove this document from the Script workspace');
    expect(actions).not.toContain("content: 'Delete this library?'");
    expect(actions).not.toContain('window.confirm');
  });

  it('Script breadcrumbs follow sidebar tree not Studio folders', () => {
    const source = read('src/lib/contexts/NavigationContext.tsx');
    expect(source).toContain('scriptParentDocumentId');
    expect(source).toContain('source_document_id');
    expect(source).toMatch(/Script sidebar tree|onScript/);
    expect(source).toContain('scriptParentDocumentName');
    expect(source).toContain('library-breadcrumb');
    expect(source).not.toMatch(
      /queryKey:\s*queryKeys\.library\(currentLibraryId\)/
    );
  });

  it('routeParams lists script-system as special segment', () => {
    const source = read('src/lib/utils/routeParams.ts');
    expect(source).toContain("'script-system'");
  });
});
