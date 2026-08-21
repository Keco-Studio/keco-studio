/** @jest-environment jsdom */

import React from 'react';
import { describe, expect, it, jest } from '@jest/globals';
import { renderToStaticMarkup } from 'react-dom/server';
import { fireEvent, render, screen } from '@testing-library/react';
import { DirectMapGenerationPanel } from '@/features/create-map/components/DirectMapGenerationPanel';
import type { DirectMapGenerationAsset } from '@/features/create-map/hooks/useDirectMapGeneration';

jest.mock('@/features/create-map/CreateMapWorkbench.module.css', () => ({
  __esModule: true,
  default: new Proxy({}, { get: (_target, property) => String(property) }),
}));

const plannedAsset: DirectMapGenerationAsset = {
  id: 'asset-1', status: 'planned', lastErrorCode: null,
  providerOperation: null, providerJobId: null,
  generationId: 'generation-1', planFingerprint: 'a'.repeat(64),
  storagePath: null, sha256: null, width: null, height: null,
  hasTransparency: null, signedUrl: null,
};

describe('DirectMapGenerationPanel', () => {
  it('opens the inline fee confirmation only after Generate map is clicked', () => {
    const generate = jest.fn();
    const props = {
      phase: 'idle', asset: null, error: null,
      canGenerate: true, canRetry: false,
      canResolveUnknown: false,
      onGenerate: generate, onRetry: jest.fn(),
      onResolveUnknown: jest.fn(),
    } as const;
    const initialMarkup = renderToStaticMarkup(React.createElement(DirectMapGenerationPanel, props));

    expect(initialMarkup).not.toContain('Paid PixelLab request');
    render(React.createElement(DirectMapGenerationPanel, props));
    fireEvent.click(screen.getByRole('button', { name: 'Generate map' }));
    expect(screen.getByRole('group', { name: 'Generation cost confirmation' })).toBeTruthy();
    expect(generate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Continue to generate' }));
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('shows validating, retry, blocked, and ready states with bounded actions', () => {
    const validating = renderToStaticMarkup(React.createElement(DirectMapGenerationPanel, {
      phase: 'validating', asset: { ...plannedAsset, status: 'generating' }, error: null,
      canGenerate: false, canRetry: false,
      canResolveUnknown: false,
      onGenerate: jest.fn(), onRetry: jest.fn(),
      onResolveUnknown: jest.fn(),
    }));
    const ready = renderToStaticMarkup(React.createElement(DirectMapGenerationPanel, {
      phase: 'ready', asset: { ...plannedAsset, status: 'ready' }, error: null,
      canGenerate: true, canRetry: false,
      canResolveUnknown: false,
      onGenerate: jest.fn(), onRetry: jest.fn(),
      onResolveUnknown: jest.fn(),
    }));

    expect(validating).toContain('Validating image');
    expect(ready).toContain('Map ready');
    expect(ready).toContain('Generate map');
  });

  it('requires explicit duplicate-billing acknowledgement for an unknown submission', () => {
    const resolveUnknown = jest.fn();
    const tree = React.createElement(DirectMapGenerationPanel, {
      phase: 'blocked',
      asset: { ...plannedAsset, status: 'queued' },
      error: null,
      canGenerate: true,
      canRetry: false,
      canResolveUnknown: true,
      onGenerate: jest.fn(),
      onRetry: jest.fn(),
      onResolveUnknown: resolveUnknown,
    });
    const markup = renderToStaticMarkup(tree);

    expect(markup).toContain('previous request may still be billed');
    expect(markup).toContain('type="checkbox"');
    expect(markup).toContain('Start a new paid attempt');
    expect(markup).toContain('disabled=""');
    expect(resolveUnknown).not.toHaveBeenCalled();
  });
});
