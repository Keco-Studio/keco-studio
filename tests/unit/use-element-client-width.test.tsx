/** @jest-environment jsdom */

import { describe, expect, it } from '@jest/globals';
import { renderHook } from '@testing-library/react';
import type { RefObject } from 'react';
import { useElementClientWidth } from '@/components/libraries/hooks/useElementClientWidth';

describe('useElementClientWidth', () => {
  it('reads the mounted element width during the layout phase', () => {
    const element = document.createElement('div');
    Object.defineProperty(element, 'clientWidth', {
      configurable: true,
      value: 720,
    });
    const elementRef = { current: element } as RefObject<HTMLDivElement | null>;

    const { result } = renderHook(() => useElementClientWidth(elementRef));

    expect(result.current).toBe(720);
  });
});
