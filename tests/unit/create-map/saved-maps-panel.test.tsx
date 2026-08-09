import React from 'react';
import { describe, expect, it, jest } from '@jest/globals';
import { renderToStaticMarkup } from 'react-dom/server';
import { SavedMapsPanel } from '@/features/create-map/components/SavedMapsPanel';
import type { SavedMapSummary } from '@/features/create-map/services/createMapService';

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
};

describe('SavedMapsPanel', () => {
  it('renders map identity, project context, update time, and selected state', () => {
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

    expect(markup).toContain('Saved Maps');
    expect(markup).toContain('River Town');
    expect(markup).toContain('Adventure');
    expect(markup).toContain('dateTime="2026-08-10T01:00:00.000Z"');
    expect(markup).toContain('aria-current="true"');
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
});
