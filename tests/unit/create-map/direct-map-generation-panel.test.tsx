import React from 'react';
import { describe, expect, it, jest } from '@jest/globals';
import { renderToStaticMarkup } from 'react-dom/server';
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

function findButton(node: React.ReactNode, label: string): React.ReactElement<{ onClick?: () => void }> | null {
  if (!React.isValidElement(node)) return null;
  const element = node as React.ReactElement<{ children?: React.ReactNode; onClick?: () => void }>;
  if (element.type === 'button' && element.props.children === label) return element;
  for (const child of React.Children.toArray(element.props.children)) {
    const found = findButton(child, label);
    if (found) return found;
  }
  return null;
}

describe('DirectMapGenerationPanel', () => {
  it('shows one paid confirmation and no resource-composition stages', () => {
    const confirm = jest.fn();
    const tree = DirectMapGenerationPanel({
      phase: 'awaiting-confirmation', asset: plannedAsset, error: null,
      canPrepare: false, canRetry: false,
      canResolveUnknown: false,
      onPrepare: jest.fn(), onConfirm: confirm, onRetry: jest.fn(), onRegenerate: jest.fn(),
      onResolveUnknown: jest.fn(),
    });
    findButton(tree, 'Confirm and generate map')?.props.onClick?.();
    const markup = renderToStaticMarkup(tree);

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(markup).toContain('Awaiting confirmation');
    expect(markup).not.toMatch(/terrain|path tiles|obstacle|compose background/i);
  });

  it('shows validating, retry, blocked, and ready states with bounded actions', () => {
    const validating = renderToStaticMarkup(React.createElement(DirectMapGenerationPanel, {
      phase: 'validating', asset: { ...plannedAsset, status: 'generating' }, error: null,
      canPrepare: false, canRetry: false,
      canResolveUnknown: false,
      onPrepare: jest.fn(), onConfirm: jest.fn(), onRetry: jest.fn(), onRegenerate: jest.fn(),
      onResolveUnknown: jest.fn(),
    }));
    const ready = renderToStaticMarkup(React.createElement(DirectMapGenerationPanel, {
      phase: 'ready', asset: { ...plannedAsset, status: 'ready' }, error: null,
      canPrepare: true, canRetry: false,
      canResolveUnknown: false,
      onPrepare: jest.fn(), onConfirm: jest.fn(), onRetry: jest.fn(), onRegenerate: jest.fn(),
      onResolveUnknown: jest.fn(),
    }));

    expect(validating).toContain('Validating image');
    expect(ready).toContain('Map ready');
    expect(ready).toContain('Regenerate map');
  });

  it('requires explicit duplicate-billing acknowledgement for an unknown submission', () => {
    const resolveUnknown = jest.fn();
    const tree = DirectMapGenerationPanel({
      phase: 'blocked',
      asset: { ...plannedAsset, status: 'queued' },
      error: null,
      canPrepare: true,
      canRetry: false,
      canResolveUnknown: true,
      onPrepare: jest.fn(),
      onConfirm: jest.fn(),
      onRetry: jest.fn(),
      onRegenerate: jest.fn(),
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
