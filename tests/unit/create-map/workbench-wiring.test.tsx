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
jest.mock('@/features/create-map/hooks/useMapSources', () => ({
  useMapSources: () => ({ projects: [], documents: [], isLoading: false, error: null }),
}));
jest.mock('@/features/create-map/hooks/useSavedMaps', () => ({
  savedMapOpenIsCurrent: (current: number, expected: number) => current === expected,
  savedMapSwitchBlocked: () => false,
  useSavedMaps: () => ({ maps: [], isLoading: false, error: null, refetch: jest.fn() }),
}));

describe('Create Map V3 direct workbench', () => {
  it('renders description-first direct map planning without composition controls', () => {
    const markup = renderToStaticMarkup(React.createElement(CreateMapWorkbench));

    expect(markup).toContain('data-testid="create-map-workbench"');
    expect(markup).toContain('data-mode="direct"');
    expect(markup).toContain('data-schema-version="3"');
    expect(markup).toContain('Description');
    expect(markup).toContain('No project');
    expect(markup).toContain('No document');
    expect(markup).toContain('Create map plan');
    expect(markup).toContain('Local plan');
    expect(markup).toContain('PixelLab description');
    expect(markup).toContain('Output profile');
    expect(markup).toContain('References');
    expect(markup).toContain('Complete map PNG');
    expect(markup).toContain('Map preview');

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
    expect(direct).toContain('service.loadSavedMapV3(');
    expect(direct).toContain('generation.installRestore(prepared)');
    expect(direct).toContain('<DirectMapCanvas');
    expect(direct).not.toContain('onOpenLegacyMap');
    expect(direct).not.toContain('map.schemaVersion === 2');
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

  it('installs V3 browser failure observers before the first navigation', () => {
    const source = readFileSync(path.join(process.cwd(), 'tests/e2e/specs/create-map-v3.spec.ts'), 'utf8');
    const helper = source.slice(source.indexOf('async function loginAndOpen'), source.indexOf('async function createSavedMap'));

    expect(helper.indexOf('observeBrowserFailures(page)')).toBeLessThan(helper.indexOf('page.goto(APP_ORIGIN)'));
    expect(source).toContain("errorText === 'net::ERR_ABORTED'");
  });

  it('invalidates persisted V3 identity when the selected Project changes', () => {
    const workbench = readFileSync(
      path.join(process.cwd(), 'src/features/create-map/DirectMapWorkbench.tsx'),
      'utf8'
    );
    const projectChangeStart = workbench.indexOf('const handleProjectChange');
    const projectChangeEnd = workbench.indexOf('\n\n  const createPlan', projectChangeStart);
    const projectChange = workbench.slice(projectChangeStart, projectChangeEnd);

    expect(projectChange).toContain("setDocumentId('')");
    expect(projectChange).toContain('setSourceToken(null)');
    expect(projectChange).toContain('draft.reset()');
    expect(projectChange).toContain('generation.reset()');
  });
});
