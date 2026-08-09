import React from 'react';
import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { CreateMapWorkbench } from '@/features/create-map/CreateMapWorkbench';
import { ObstacleInspector } from '@/features/create-map/components/ObstacleInspector';

jest.mock('@/features/create-map/CreateMapWorkbench.module.css', () => ({
  __esModule: true,
  default: new Proxy({}, { get: (_target, property) => String(property) }),
}));

jest.mock('@/lib/SupabaseContext', () => ({ useSupabase: () => ({}) }));
jest.mock('@/features/create-map/hooks/useMapSources', () => ({
  useMapSources: () => ({ projects: [], documents: [], isLoading: false, error: null }),
}));
jest.mock('@/features/create-map/hooks/useSavedMaps', () => ({
  useSavedMaps: () => ({ maps: [], isLoading: false, error: null, refetch: jest.fn() }),
}));
jest.mock('@/features/create-map/hooks/useMapDraft', () => ({
  useMapDraft: () => ({
    identity: null, status: 'idle', error: null, isDirty: false,
    create: jest.fn(), reload: jest.fn(), saveAsNewRevision: jest.fn(), install: jest.fn(),
    publishForGeneration: jest.fn(),
  }),
}));

describe('Create Map workbench controls', () => {
  it('renders source, workflow, layers, canvas tools, plan, object, inpaint, save, and retry controls', () => {
    const markup = renderToStaticMarkup(React.createElement(CreateMapWorkbench));

    expect(markup).toContain('data-testid="create-map-workbench"');
    expect(markup).toContain('Select a project');
    expect(markup).toContain('Select a document');
    expect(markup).toContain('Create map plan');
    expect(markup).toContain('Workflow');
    expect(markup).toContain('role="tablist"');
    expect(markup).toContain('Layers');
    expect(markup).toContain('Objects');
    expect(markup).toContain('aria-label="Map canvas tools"');
    expect(markup).toContain('aria-label="Select"');
    expect(markup).toContain('aria-label="Hand tool"');
    expect(markup).toContain('aria-label="Rectangle obstacle"');
    expect(markup).toContain('aria-label="Circle obstacle"');
    expect(markup).toContain('aria-label="Polygon obstacle"');
    expect(markup).toContain('aria-label="Inpaint mask"');
    expect(markup).toContain('aria-label="Undo"');
    expect(markup).toContain('aria-label="Redo"');
    expect(markup).toContain('aria-label="Zoom in"');
    expect(markup).toContain('aria-label="Zoom out"');
    expect(markup).toContain('Local preview');
    expect(markup).toContain('Ready');
    expect(markup).toContain('Map plan');
    expect(markup).toContain('Object');
    expect(markup).toContain('Inpaint');
    expect(markup).toContain('Generate selection');
    expect(markup).toContain('Apply revision');
    expect(markup).toContain('Rollback');
  });

  it('renders editable obstacle geometry and deletion controls', () => {
    const markup = renderToStaticMarkup(
      React.createElement(ObstacleInspector, {
        obstacle: { id: 'wall-1', shape: 'rectangle', x: 8, y: 16, width: 64, height: 32 },
        onChange: () => undefined,
        onDelete: () => undefined,
      })
    );

    expect(markup).toContain('Obstacle');
    expect(markup).toContain('Width');
    expect(markup).toContain('Height');
    expect(markup).toContain('Delete obstacle');
  });

  it('scopes compact mobile TopBar behavior to Create Map', () => {
    const topBar = readFileSync(path.join(process.cwd(), 'src/components/layout/TopBar.tsx'), 'utf8');
    const css = readFileSync(path.join(process.cwd(), 'src/components/layout/TopBar.module.css'), 'utf8');

    expect(topBar).toContain('isCreateMapPath(pathname)');
    expect(topBar).toContain('styles.headerCreateMap');
    expect(css).toMatch(/@media\s*\(max-width:\s*680px\)[\s\S]*?\.headerCreateMap \.searchContainer\s*\{[\s\S]*?display:\s*none/);
  });

  it('wires transient pointer previews, one final command, and pointer cancellation', () => {
    const canvas = readFileSync(
      path.join(process.cwd(), 'src/features/create-map/components/MapCanvas.tsx'),
      'utf8'
    );

    expect(canvas).toContain('previewInteraction(');
    expect(canvas).toContain('commandForInteraction(');
    expect(canvas).toContain('onPointerCancel={handlePointerCancel}');
    expect(canvas).toMatch(/setInteraction\(null\)[\s\S]*setInteractionPoint\(null\)/);
  });

  it('installs only a complete, current saved-map request and clears transient editor state', () => {
    const workbench = readFileSync(
      path.join(process.cwd(), 'src/features/create-map/CreateMapWorkbench.tsx'),
      'utf8'
    );

    expect(workbench).toContain('useSavedMaps()');
    expect(workbench).toContain('openRequestRef.current');
    expect(workbench).toContain('canSwitchMapsRef.current');
    expect(workbench).toContain('setGeneratedImages(new Map())');
    expect(workbench).toContain("key={draft.identity?.mapId ?? 'local-preview'}");

    const openStart = workbench.indexOf('const openSavedMap');
    const openEnd = workbench.indexOf('\n  return (', openStart);
    const openSavedMap = workbench.slice(openStart, openEnd);
    const loadIndex = openSavedMap.indexOf('await service.loadSavedMap(summary.id)');
    const prepareIndex = openSavedMap.indexOf('await generation.prepareRestore(');
    const staleGuardIndex = openSavedMap.indexOf('if (request !== openRequestRef.current) return;');
    const dirtyGuardIndex = openSavedMap.indexOf('if (!canSwitchMapsRef.current) return;');

    expect(loadIndex).toBeGreaterThan(-1);
    expect(prepareIndex).toBeGreaterThan(loadIndex);
    expect(staleGuardIndex).toBeGreaterThan(prepareIndex);
    expect(dirtyGuardIndex).toBeGreaterThan(staleGuardIndex);
    for (const installation of [
      'setProjectId(loaded.projectId)',
      'setDocumentId(loaded.sourceDocumentId)',
      'setPlan(loaded.plan)',
      'setEditor(createEditorState(loaded.scene))',
      'setSelection(null)',
      'setGeneratedImages(new Map())',
      'draft.install(loaded)',
      'generation.installRestore(prepared)',
    ]) {
      expect(openSavedMap.indexOf(installation)).toBeGreaterThan(dirtyGuardIndex);
    }
  });
});
