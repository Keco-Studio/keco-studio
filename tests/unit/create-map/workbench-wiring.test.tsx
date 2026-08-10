import React from 'react';
import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  CreateMapWorkbench,
  getPlanReviewActions,
} from '@/features/create-map/CreateMapWorkbench';

jest.mock('@/features/create-map/CreateMapWorkbench.module.css', () => ({
  __esModule: true,
  default: new Proxy({}, { get: (_target, property) => String(property) }),
}));

jest.mock('@/lib/SupabaseContext', () => ({ useSupabase: () => ({}) }));
jest.mock('@/features/create-map/hooks/useMapSources', () => ({
  useMapSources: () => ({ projects: [], documents: [], isLoading: false, error: null }),
}));

describe('Create Map V2 Plan Review workbench', () => {
  it('renders description-first local Plan Review without legacy scene controls', () => {
    const markup = renderToStaticMarkup(React.createElement(CreateMapWorkbench));

    expect(markup).toContain('data-testid="create-map-workbench"');
    expect(markup).toContain('data-mode="plan-review"');
    expect(markup).toContain('Description');
    expect(markup).toContain('No project');
    expect(markup).toContain('No document');
    expect(markup).toContain('Create map plan');
    expect(markup).toContain('Local plan');
    expect(markup).toContain('Plan structure');
    expect(markup).toContain('aria-label="Map plan structure"');
    expect(markup).toContain('aria-label="Select structure"');
    expect(markup).toContain('aria-label="Edit terrain regions"');
    expect(markup).toContain('aria-label="Edit paths"');
    expect(markup).toContain('aria-label="Move planned obstacles"');
    expect(markup).toContain('aria-label="Undo"');
    expect(markup).toContain('aria-label="Redo"');
    expect(markup).toContain('aria-label="Zoom in"');
    expect(markup).toContain('aria-label="Zoom out"');
    expect(markup).toContain('aria-label="Map plan structure canvas"');

    expect(markup).not.toContain('Inpaint');
    expect(markup).not.toContain('Rectangle obstacle');
    expect(markup).not.toContain('Circle obstacle');
    expect(markup).not.toContain('Polygon obstacle');
    expect(markup).not.toContain('Regenerate');
  });

  it('requires a valid Project-backed clean draft before generation', () => {
    expect(getPlanReviewActions({
      projectId: '', hasIdentity: false, valid: true, dirty: false, busy: false,
    })).toEqual({ canSave: false, canGenerate: false });
    expect(getPlanReviewActions({
      projectId: 'project-1', hasIdentity: false, valid: true, dirty: false, busy: false,
    })).toEqual({ canSave: true, canGenerate: false });
    expect(getPlanReviewActions({
      projectId: 'project-1', hasIdentity: true, valid: true, dirty: false, busy: false,
    })).toEqual({ canSave: false, canGenerate: true });
    expect(getPlanReviewActions({
      projectId: 'project-1', hasIdentity: true, valid: true, dirty: true, busy: false,
    })).toEqual({ canSave: true, canGenerate: false });
    expect(getPlanReviewActions({
      projectId: 'project-1', hasIdentity: true, valid: false, dirty: true, busy: false,
    })).toEqual({ canSave: false, canGenerate: false });
  });

  it('scopes compact mobile TopBar behavior to Create Map', () => {
    const topBar = readFileSync(path.join(process.cwd(), 'src/components/layout/TopBar.tsx'), 'utf8');
    const css = readFileSync(path.join(process.cwd(), 'src/components/layout/TopBar.module.css'), 'utf8');

    expect(topBar).toContain('isCreateMapPath(pathname)');
    expect(topBar).toContain('styles.headerCreateMap');
    expect(css).toMatch(/@media\s*\(max-width:\s*680px\)[\s\S]*?\.headerCreateMap \.searchContainer\s*\{[\s\S]*?display:\s*none/);
  });

  it('invalidates persisted V2 identity when the selected Project changes', () => {
    const workbench = readFileSync(
      path.join(process.cwd(), 'src/features/create-map/CreateMapWorkbench.tsx'),
      'utf8'
    );
    const projectChangeStart = workbench.indexOf('const handleProjectChange');
    const projectChangeEnd = workbench.indexOf('\n\n  const createPlan', projectChangeStart);
    const projectChange = workbench.slice(projectChangeStart, projectChangeEnd);

    expect(projectChange).toContain("setDocumentId('')");
    expect(projectChange).toContain('setSourceToken(null)');
    expect(projectChange).toContain('setIdentity(null)');
    expect(projectChange).toContain('setSavedPayload(null)');
  });
});
