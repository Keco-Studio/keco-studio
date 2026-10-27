/** @jest-environment jsdom */
import React from 'react';
import { describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { SavedMapsPanel } from '@/features/create-map/components/SavedMapsPanel';
import {
  savedMapOpenIsCurrent,
  savedMapSwitchBlocked,
} from '@/features/create-map/hooks/useSavedMaps';
import type { SavedMapSummary } from '@/features/create-map/services/createMapService';

jest.mock('@/lib/SupabaseContext', () => ({ useSupabase: () => ({}) }));
jest.mock('@/lib/contexts/AuthContext', () => ({ useAuth: () => ({ userProfile: null }) }));
jest.mock('@/features/create-map/CreateMapWorkbench.module.css', () => ({
  __esModule: true,
  default: new Proxy({}, { get: (_target, property) => String(property) }),
}));

const summary: SavedMapSummary = {
  id: 'map-1',
  projectId: 'project-1',
  projectName: 'Adventure',
  name: 'River Town',
  currentRevisionId: 'revision-2',
  updatedAt: '2026-08-10T01:00:00.000Z',
  schemaVersion: 3,
};

describe('SavedMapsPanel', () => {
  it('renders map identity, update time, and selected state without duplicating the project name', () => {
    const markup = renderToStaticMarkup(<SavedMapsPanel
      maps={[summary]}
      isLoading={false}
      error={null}
      activeMapId="map-1"
      openingMapId={null}
      disabled={false}
      onOpen={() => undefined}
      onRetry={() => undefined}
    />);

    expect(markup).toContain('Saved maps');
    expect(markup).toContain('River Town');
    expect(markup).not.toContain('Adventure');
    expect(markup).not.toContain('v3');
    expect(markup).toContain('dateTime="2026-08-10T01:00:00.000Z"');
    expect(markup).toContain('aria-current="true"');
    expect(markup).toContain('aria-label="Search saved maps"');
    expect(markup).toContain('aria-label="Create map"');
  });

  it('disables rows while switching would replace active work', () => {
    const markup = renderToStaticMarkup(<SavedMapsPanel
      maps={[summary]}
      isLoading={false}
      error={null}
      activeMapId={null}
      openingMapId={null}
      disabled
      onOpen={() => undefined}
      onRetry={() => undefined}
    />);

    expect(markup).toContain('disabled=""');
  });

  it('fills the active map row with the sidebar selection surface', () => {
    const css = readFileSync(
      path.join(process.cwd(), 'src/features/create-map/CreateMapWorkbench.module.css'),
      'utf8',
    );

    expect(css).toMatch(/\.savedMapButtonActive\s*\{[^}]*border-color:\s*transparent[^}]*background:\s*#f3f6f8/s);
  });

  it('renders retryable error and empty states without map rows', () => {
    const errorMarkup = renderToStaticMarkup(<SavedMapsPanel
      maps={[]}
      isLoading={false}
      error="Could not load maps"
      activeMapId={null}
      openingMapId={null}
      disabled={false}
      onOpen={() => undefined}
      onRetry={() => undefined}
    />);
    const emptyMarkup = renderToStaticMarkup(<SavedMapsPanel
      maps={[]}
      isLoading={false}
      error={null}
      activeMapId={null}
      openingMapId={null}
      disabled={false}
      onOpen={() => undefined}
      onRetry={() => undefined}
    />);

    expect(errorMarkup).toContain('role="alert"');
    expect(errorMarkup).toContain('aria-label="Retry saved maps"');
    expect(emptyMarkup).toContain('No saved maps');
  });

  it('uses the compact empty-state treatment in the narrow Map sidebar', () => {
    const source = readFileSync(
      path.join(process.cwd(), 'src/features/create-map/components/SavedMapsPanel.tsx'),
      'utf8',
    );

    expect(source).toMatch(/<EmptyContentState[^>]*compact/);
  });

  it('blocks dirty, saving, and conflicted drafts but permits clean saved workspaces', () => {
    expect(savedMapSwitchBlocked({ isDirty: true, status: 'saved' })).toBe(true);
    expect(savedMapSwitchBlocked({ isDirty: false, status: 'saving' })).toBe(true);
    expect(savedMapSwitchBlocked({ isDirty: false, status: 'conflict' })).toBe(true);
    expect(savedMapSwitchBlocked({ isDirty: false, status: 'saved' })).toBe(false);
  });

  it('uses the V3 saved-map service and invalidates older open requests', () => {
    const hook = readFileSync(
      path.join(process.cwd(), 'src/features/create-map/hooks/useSavedMaps.ts'),
      'utf8',
    );
    expect(hook).toContain("['create-map', 'saved-maps', 'v3'");
    expect(hook).toContain('service.listSavedMaps()');
    expect(savedMapOpenIsCurrent(7, 7)).toBe(true);
    expect(savedMapOpenIsCurrent(8, 7)).toBe(false);
  });

  it('marks only the pending row as busy', () => {
    const markup = renderToStaticMarkup(<SavedMapsPanel
      maps={[summary]}
      isLoading={false}
      error={null}
      activeMapId={null}
      openingMapId="map-1"
      disabled={false}
      onOpen={() => undefined}
      onRetry={() => undefined}
    />);

    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain('Opening...');
  });

  it('keeps the same conversation row mounted when its latest map changes', () => {
    const first = {
      ...summary,
      conversationId: 'conversation-1',
      name: 'River Town conversation',
    };
    const view = render(<SavedMapsPanel
      maps={[first]}
      isLoading={false}
      error={null}
      activeMapId={null}
      openingMapId={null}
      disabled={false}
      onOpen={() => undefined}
      onRetry={() => undefined}
    />);
    const originalRow = screen.getByRole('button', { name: /River Town conversation/ });

    view.rerender(<SavedMapsPanel
      maps={[{
        ...first,
        id: 'map-2',
        currentRevisionId: 'revision-3',
        updatedAt: '2026-08-10T02:00:00.000Z',
      }]}
      isLoading={false}
      error={null}
      activeMapId={null}
      openingMapId={null}
      disabled={false}
      onOpen={() => undefined}
      onRetry={() => undefined}
    />);

    expect(screen.getByRole('button', { name: /River Town conversation/ })).toBe(originalRow);
    view.unmount();
  });

  it('keeps separate GDD map rows keyed by map when they share a conversation', () => {
    const first = {
      ...summary,
      id: 'gdd-map-1',
      conversationId: 'gdd-conversation-1',
      name: 'Harbor District',
    };
    const second = {
      ...summary,
      id: 'gdd-map-2',
      conversationId: 'gdd-conversation-1',
      name: 'Castle Courtyard',
    };
    const view = render(<SavedMapsPanel
      maps={[first, second]}
      isLoading={false}
      error={null}
      activeMapId={null}
      openingMapId={null}
      disabled={false}
      onOpen={() => undefined}
      onRetry={() => undefined}
    />);
    const originalFirstRow = screen.getByRole('button', { name: /Harbor District/ });
    const originalSecondRow = screen.getByRole('button', { name: /Castle Courtyard/ });

    view.rerender(<SavedMapsPanel
      maps={[second, first]}
      isLoading={false}
      error={null}
      activeMapId={null}
      openingMapId={null}
      disabled={false}
      onOpen={() => undefined}
      onRetry={() => undefined}
    />);

    expect(screen.getByRole('button', { name: /Harbor District/ })).toBe(originalFirstRow);
    expect(screen.getByRole('button', { name: /Castle Courtyard/ })).toBe(originalSecondRow);
    view.unmount();
  });
});
