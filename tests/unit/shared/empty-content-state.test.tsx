import React from 'react';
import { describe, expect, it, jest } from '@jest/globals';
import { renderToStaticMarkup } from 'react-dom/server';
import { EmptyContentState } from '@/components/shared/EmptyContentState';

jest.mock('next/image', () => ({
  __esModule: true,
  default: ({ priority: _priority, ...props }: Record<string, unknown>) => React.createElement('img', props),
}));
jest.mock('@/components/shared/EmptyContentState.module.css', () => ({
  __esModule: true,
  default: new Proxy({}, { get: (_target, property) => String(property) }),
}));

describe('EmptyContentState', () => {
  it('renders the Recent empty-state illustration at the shared 88px size', () => {
    const markup = renderToStaticMarkup(
      <EmptyContentState message="No saved maps yet" />,
    );

    expect(markup).toContain('data-testid="empty-content-state"');
    expect(markup).toContain('width="88"');
    expect(markup).toContain('height="88"');
    expect(markup).toContain('No saved maps yet');
  });
});
