import React from 'react';
import { describe, expect, it } from '@jest/globals';
import { renderToStaticMarkup } from 'react-dom/server';
import { RegionGenerationPanel } from '@/features/create-map/components/RegionGenerationPanel';
import type { RegionObstacleGenerationState } from '@/features/create-map/hooks/useRegionObstacleGeneration';

jest.mock('@/features/create-map/CreateMapWorkbench.module.css', () => ({
  __esModule: true,
  default: new Proxy({}, { get: (_target, property) => String(property) }),
}));

function state(overrides: Partial<RegionObstacleGenerationState> = {}): RegionObstacleGenerationState {
  return {
    selection: null,
    prompt: '',
    phase: 'empty',
    error: null,
    asset: null,
    setPrompt: () => undefined,
    generate: async () => undefined,
    reset: () => undefined,
    ...overrides,
  };
}

describe('regional obstacle generation panel', () => {
  it('renders the empty selection state with generation disabled', () => {
    const markup = renderToStaticMarkup(React.createElement(RegionGenerationPanel, {
      ...state(), onClearSelection: () => undefined,
    }));
    expect(markup).toContain('Select a map region');
    expect(markup).toContain('Drag a rectangle on the Scene canvas first.');
    expect(markup).toMatch(/<button[^>]+disabled=""[^>]*>.*Generate obstacle/s);
  });

  it('preserves selection and prompt in the retryable failed state', () => {
    const markup = renderToStaticMarkup(React.createElement(RegionGenerationPanel, {
      ...state({
        selection: { x: 10, y: 20, width: 64, height: 48 },
        prompt: 'Mossy shrine',
        phase: 'failed',
        error: 'provider failed',
      }),
      onClearSelection: () => undefined,
    }));
    expect(markup).toContain('64 x 48 px');
    expect(markup).toContain('Mossy shrine');
    expect(markup).toContain('Retry obstacle');
    expect(markup).toContain('provider failed');
  });

  it('locks selection and prompt while provider work is active', () => {
    const markup = renderToStaticMarkup(React.createElement(RegionGenerationPanel, {
      ...state({
        selection: { x: 10, y: 20, width: 64, height: 48 },
        prompt: 'Mossy shrine',
        phase: 'generating',
      }),
      onClearSelection: () => undefined,
    }));
    expect(markup).toContain('Generating obstacle');
    expect(markup).toMatch(/<textarea[^>]+disabled=""/);
    expect(markup).toContain('Generating');
  });
});
