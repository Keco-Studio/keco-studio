import React from 'react';
import { describe, expect, it, jest } from '@jest/globals';
import { renderToStaticMarkup } from 'react-dom/server';

import { DirectMapCollisionPanel } from '@/features/create-map/components/DirectMapCollisionPanel';
import { createEmptyCollisionGrid } from '@/features/create-map/model/directMapCollisionGrid';

jest.mock('@/features/create-map/CreateMapWorkbench.module.css', () => ({
  __esModule: true,
  default: new Proxy({}, { get: (_target, property) => String(property) }),
}));

function findButton(node: React.ReactNode, label: string): React.ReactElement<{ onClick?: () => void }> | null {
  if (!React.isValidElement(node)) return null;
  const element = node as React.ReactElement<{ children?: React.ReactNode; onClick?: () => void }>;
  if (element.type === 'button') {
    const text = React.Children.toArray(element.props.children)
      .filter((child): child is string => typeof child === 'string')
      .join('')
      .trim();
    if (text === label) return element;
  }
  for (const child of React.Children.toArray(element.props.children)) {
    const found = findButton(child, label);
    if (found) return found;
  }
  return null;
}

describe('DirectMapCollisionPanel', () => {
  it('offers manual editing when automatic collision analysis fails', () => {
    const startManualEditing = jest.fn();
    const tree = DirectMapCollisionPanel({
      grid: null,
      phase: 'failed',
      error: 'Collision analysis model is unavailable. Retry or edit manually.',
      overlayVisible: true,
      paintMode: 1,
      onOverlayVisibleChange: jest.fn(),
      onPaintModeChange: jest.fn(),
      onRetry: jest.fn(),
      onClear: startManualEditing,
    });

    findButton(tree, 'Edit manually')?.props.onClick?.();
    const markup = renderToStaticMarkup(tree);

    expect(markup).toContain('Analysis failed');
    expect(markup).toContain('Retry analysis');
    expect(markup).toContain('Edit manually');
    expect(startManualEditing).toHaveBeenCalledTimes(1);
  });

  it('allows an existing grid to be explicitly re-analyzed by AI', () => {
    const retry = jest.fn();
    const tree = DirectMapCollisionPanel({
      grid: createEmptyCollisionGrid(512, 512, 'a'.repeat(64)),
      phase: 'ready',
      error: null,
      overlayVisible: true,
      paintMode: 1,
      onOverlayVisibleChange: jest.fn(),
      onPaintModeChange: jest.fn(),
      onRetry: retry,
      onClear: jest.fn(),
    });

    findButton(tree, 'Re-analyze with AI')?.props.onClick?.();

    expect(renderToStaticMarkup(tree)).toContain('Re-analyze with AI');
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
