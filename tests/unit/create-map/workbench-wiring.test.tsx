import React from 'react';
import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { CreateMapWorkbench } from '@/features/create-map/CreateMapWorkbench';

jest.mock('@/features/create-map/CreateMapWorkbench.module.css', () => ({
  __esModule: true,
  default: new Proxy({}, { get: (_target, property) => String(property) }),
}));

jest.mock('@/lib/SupabaseContext', () => ({ useSupabase: () => ({}) }));
jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
}));
jest.mock('@/features/create-map/hooks/useMapSources', () => ({
  useMapSources: () => ({ projects: [], documents: [], isLoading: false, error: null }),
}));
jest.mock('@/features/create-map/hooks/useSavedMaps', () => ({
  savedMapOpenIsCurrent: (current: number, expected: number) => current === expected,
  savedMapSwitchBlocked: () => false,
  useSavedMaps: () => ({ maps: [], isLoading: false, error: null, refetch: jest.fn() }),
}));
jest.mock('@/features/create-map/hooks/useMapDraft', () => ({
  createMapDraftAdapterV3: () => ({}),
  useMapDraft: () => ({
    identity: null,
    status: 'idle',
    isDirty: false,
    isValid: true,
    error: null,
    create: jest.fn(),
    reset: jest.fn(),
    install: jest.fn(),
    reload: jest.fn(),
  }),
}));
jest.mock('@/features/create-map/hooks/useDirectMapGeneration', () => ({
  useDirectMapGeneration: () => ({
    phase: 'idle',
    asset: null,
    error: null,
    boundImage: null,
    canRetry: false,
    canResolveUnknown: false,
    generate: jest.fn(),
    retry: jest.fn(),
    resolveUnknownAndRestart: jest.fn(),
    reset: jest.fn(),
    prepareRestore: jest.fn(),
    installRestore: jest.fn(),
  }),
}));
jest.mock('@/features/create-map/hooks/useMapGenerationHistory', () => ({
  useMapGenerationHistory: () => ({ revisions: [], refetch: jest.fn() }),
}));
jest.mock('@/features/create-map/hooks/useDirectMapCollisionGrid', () => ({
  useDirectMapCollisionGrid: () => ({
    phase: 'idle',
    error: null,
    overlayVisible: false,
    paintMode: false,
    setOverlayVisible: jest.fn(),
    setPaintMode: jest.fn(),
    paintCell: jest.fn(),
    retry: jest.fn(),
    clearGrid: jest.fn(),
  }),
}));
jest.mock('@/features/create-map/services/createMapService', () => ({
  createMapService: () => ({
    listReferences: async () => [],
    createPlanV3: jest.fn(),
    loadSavedMapV3: jest.fn(),
    uploadReference: jest.fn(),
  }),
}));

describe('Create Map V3 direct workbench', () => {
  it('renders the Map Generator shell with browse and plan controls', () => {
    const markup = renderToStaticMarkup(React.createElement(CreateMapWorkbench));

    expect(markup).toContain('data-testid="create-map-workbench"');
    expect(markup).toContain('data-mode="direct"');
    expect(markup).toContain('data-schema-version="3"');
    expect(markup).toContain('Map Generator');
    expect(markup).toContain('Manage and config game assets for game designers.');
    expect(markup).toContain('Select project');
    expect(markup).toContain('Saved maps');
    expect(markup).not.toContain('Local plan');
    expect(markup).toContain('Map preview');
    expect(markup).not.toContain('Save draft');
    expect(markup).not.toContain('Prepare map generation');
    expect(markup).not.toContain('Confirm and generate map');

    expect(markup).not.toContain('Inpaint');
    expect(markup).not.toContain('Rectangle obstacle');
    expect(markup).not.toContain('Circle obstacle');
    expect(markup).not.toContain('Polygon obstacle');
    expect(markup).not.toContain('Regenerate');
  });

  it('routes only V3 without loading a legacy workbench', () => {
    const router = readFileSync(
      path.join(process.cwd(), 'src/features/create-map/CreateMapWorkbench.tsx'),
      'utf8'
    );
    const direct = readFileSync(path.join(process.cwd(), 'src/features/create-map/DirectMapWorkbench.tsx'), 'utf8');

    expect(router).toContain('<DirectMapWorkbench');
    expect(router).not.toContain('LegacyCreateMapV2Workbench');
    expect(router).not.toContain('useState');
    expect(direct).toContain('service.createPlanV3(');
    expect(direct).toContain('await draft.create(projectId, created.sourceToken, created.plan, nextScene)');
    expect(direct).toContain('service.loadSavedMapV3(');
    expect(direct).toContain('generation.installRestore(prepared)');
    expect(direct).toContain('<DirectMapCanvas');
    expect(direct).toContain('<MapChatPanel');
    expect(direct).toContain('onAttachFile=');
    expect(direct).toContain('onAttachKecoDocument=');
    expect(direct).toContain('<SelectDocumentModal');
    expect(direct).not.toContain('onOpenLegacyMap');
    expect(direct).not.toContain('map.schemaVersion === 2');

    const css = readFileSync(
      path.join(process.cwd(), 'src/features/create-map/CreateMapWorkbench.module.css'),
      'utf8'
    );
    expect(css).toContain('grid-template-columns: 300px minmax(0, 1fr)');
    expect(css).toContain('.chatAttachMenu');
  });

  it('requires every draft consumer to provide an explicit versioned adapter', () => {
    const source = readFileSync(
      path.join(process.cwd(), 'src/features/create-map/hooks/useMapDraft.ts'),
      'utf8'
    );

    expect(source).not.toContain('createMapDraftAdapterV2');
    expect(source).not.toMatch(/adapter\?\s*:/);
    expect(source).not.toMatch(/adapter\s*\?\?/);
  });

  it('scopes compact mobile TopBar behavior to Create Map', () => {
    const topBar = readFileSync(path.join(process.cwd(), 'src/components/layout/TopBar.tsx'), 'utf8');
    const css = readFileSync(path.join(process.cwd(), 'src/components/layout/TopBar.module.css'), 'utf8');

    expect(topBar).toContain('isCreateMapPath(pathname)');
    expect(topBar).toContain('styles.headerCreateMap');
    expect(css).toMatch(/@media\s*\(max-width:\s*680px\)[\s\S]*?\.headerCreateMap \.searchContainer\s*\{[\s\S]*?display:\s*none/);
  });

  it('exposes an accessible source-panel toggle in the compact Create Map header', () => {
    const topBar = readFileSync(path.join(process.cwd(), 'src/components/layout/TopBar.tsx'), 'utf8');

    expect(topBar).toMatch(/<button[^>]*aria-label="Open source panel"[^>]*onClick=\{handleSidebarToggle\}/s);
  });

  it('does not render library Create or view controls in the Map top bar', () => {
    const topBar = readFileSync(path.join(process.cwd(), 'src/components/layout/TopBar.tsx'), 'utf8');

    expect(topBar).toMatch(/if \(onCreateMap\) \{\s*return null;\s*\}/);
  });

  it('keeps the Map Generator sidebar full-height and aligned with Libraries controls', () => {
    const workbenchCss = readFileSync(
      path.join(process.cwd(), 'src/features/create-map/CreateMapWorkbench.module.css'),
      'utf8',
    );
    const topBarCss = readFileSync(
      path.join(process.cwd(), 'src/components/layout/TopBar.module.css'),
      'utf8',
    );

    expect(topBarCss).toMatch(/\.headerCreateMap\s*\{[^}]*margin-left:\s*300px[^}]*margin-bottom:\s*-4rem/s);
    expect(workbenchCss).toMatch(/\.leftPanel\s*\{[^}]*background:\s*#fafafa[^}]*border-right:\s*0\.5px solid #11111133/s);
    expect(workbenchCss).toMatch(/\.directCanvasPanel,\s*\.rightPanel\s*\{[^}]*margin-top:\s*4rem[^}]*height:\s*calc\(100% - 4rem\)/s);
    expect(workbenchCss).toMatch(/\.savedMapsSection\s*\{[^}]*margin-top:\s*16px[^}]*padding:\s*0 8px 16px/s);
    expect(workbenchCss).toMatch(/\.savedMapsSearch\s*\{[^}]*height:\s*30px[^}]*border:\s*0[^}]*border-radius:\s*88px[^}]*background:\s*#f1f5f9/s);
  });

  it('notifies the TopBar of sidebar state only after the Map workbench commits', () => {
    const workbench = readFileSync(
      path.join(process.cwd(), 'src/features/create-map/DirectMapWorkbench.tsx'),
      'utf8',
    );

    expect(workbench).not.toMatch(/setLeftCollapsed\(\(collapsed\)\s*=>\s*\{[\s\S]*?window\.dispatchEvent/);
    expect(workbench).toMatch(/useEffect\(\(\)\s*=>\s*\{[\s\S]*?CREATE_MAP_SIDEBAR_STATE_EVENT[\s\S]*?\},\s*\[leftCollapsed\]\)/);
  });

  it('removes the right grid track when Map plan details are closed', () => {
    const workbench = readFileSync(
      path.join(process.cwd(), 'src/features/create-map/DirectMapWorkbench.tsx'),
      'utf8',
    );
    const css = readFileSync(
      path.join(process.cwd(), 'src/features/create-map/CreateMapWorkbench.module.css'),
      'utf8',
    );

    expect(workbench).toContain("showRightPanel ? '' : styles.workbenchCanvasOnly");
    expect(css).toMatch(/\.workbenchLeftCollapsed\.workbenchCanvasOnly\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s);
    expect(css).toMatch(/\.workbenchCanvasOnly \.directCanvasPanel\s*\{[^}]*grid-column:\s*2 \/ -1/s);
  });

  it('installs V3 browser failure observers before the first navigation', () => {
    const source = readFileSync(path.join(process.cwd(), 'tests/e2e/specs/create-map-v3.spec.ts'), 'utf8');
    const helper = source.slice(source.indexOf('async function loginAndOpen'), source.indexOf('async function createSavedMap'));

    expect(helper.indexOf('observeBrowserFailures(page)')).toBeLessThan(helper.indexOf('page.goto(APP_ORIGIN)'));
    expect(source).toContain("errorText === 'net::ERR_ABORTED'");
    expect(source).toContain("**/api/keco-admin/access");
    expect(source).toContain('isAdmin: false');
  });

  it('invalidates persisted V3 identity when the selected Project changes', () => {
    const workbench = readFileSync(
      path.join(process.cwd(), 'src/features/create-map/DirectMapWorkbench.tsx'),
      'utf8'
    );
    const projectChangeStart = workbench.indexOf('const handleProjectChange');
    const projectChangeEnd = workbench.indexOf('\n\n  const enterCreateDetail', projectChangeStart);
    const projectChange = workbench.slice(projectChangeStart, projectChangeEnd);

    expect(projectChange).toContain("setDocumentId('')");
    expect(projectChange).toContain('draft.reset()');
    expect(projectChange).toContain('generation.reset()');
    expect(projectChange).toContain("setViewMode('browse')");
  });

  it('opens GDD map deep links and disables mutation controls in viewer mode', () => {
    const workbench = readFileSync(
      path.join(process.cwd(), 'src/features/create-map/DirectMapWorkbench.tsx'),
      'utf8',
    );
    expect(workbench).toContain('useSearchParams');
    expect(workbench).toContain("searchParams?.get('mapId')");
    expect(workbench).toContain("searchParams?.get('viewer') === '1'");
    expect(workbench).toContain('openedRequestedMapId');
    expect(workbench).toContain('void openSavedMap(requestedMap)');
    expect(workbench).toContain('onPaintCell={readOnly ? undefined : collision.paintCell}');
    expect(workbench).toContain('readOnly={readOnly}');
  });
});
