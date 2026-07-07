import { describe, expect, it, jest } from '@jest/globals';
import { isValidElement } from 'react';
import { RouteErrorBoundary, RouteNotFoundBoundary } from '../../../src/components/shared/RouteBoundary';

/**
 * Structural assertions on the returned element tree — the project's unit suite
 * runs in a node env without jsdom, so we inspect props directly rather than
 * mounting. Verifies the shared boundaries wire copy/handlers through correctly.
 */

type El = { type: unknown; props: Record<string, unknown> };
function children(el: El): El[] {
  const c = el.props.children;
  return (Array.isArray(c) ? c : [c]).filter(isValidElement) as unknown as El[];
}

describe('RouteErrorBoundary', () => {
  it('renders title, message, and a retry button wired to reset', () => {
    const reset = jest.fn();
    const el = RouteErrorBoundary({ title: 'Boom', message: 'It broke', reset }) as unknown as El;
    const kids = children(el);

    expect(kids.find((k) => k.type === 'h1')?.props.children).toBe('Boom');
    expect(kids.find((k) => k.type === 'p')?.props.children).toBe('It broke');

    const button = kids.find((k) => k.type === 'button');
    expect(button?.props.children).toBe('Try again');
    (button?.props.onClick as () => void)();
    expect(reset).toHaveBeenCalledTimes(1);
  });
});

describe('RouteNotFoundBoundary', () => {
  it('renders title, message, and a back-link defaulting to /projects', () => {
    const el = RouteNotFoundBoundary({ title: 'Gone', message: 'No such thing' }) as unknown as El;
    const kids = children(el);

    expect(kids.find((k) => k.type === 'h1')?.props.children).toBe('Gone');
    const link = kids.find((k) => typeof k.type !== 'string');
    expect(link?.props.href).toBe('/projects');
    expect(link?.props.children).toBe('Back to projects');
  });

  it('honors a custom back-link target and label', () => {
    const el = RouteNotFoundBoundary({
      title: 'Gone',
      message: 'No such thing',
      backHref: '/home',
      backLabel: 'Home',
    }) as unknown as El;
    const link = children(el).find((k) => typeof k.type !== 'string');
    expect(link?.props.href).toBe('/home');
    expect(link?.props.children).toBe('Home');
  });
});
