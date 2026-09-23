import { useLayoutEffect, useState, type RefObject } from 'react';

/**
 * Measures before paint so width-dependent table layouts do not render an
 * intermediate default state, then stays in sync with the element size.
 */
export function useElementClientWidth<T extends HTMLElement>(
  elementRef: RefObject<T | null>,
): number {
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const element = elementRef.current;
    if (!element) return;

    const updateWidth = () => {
      const nextWidth = Math.floor(element.clientWidth);
      setWidth((currentWidth) => currentWidth === nextWidth ? currentWidth : nextWidth);
    };
    updateWidth();

    const observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(updateWidth);
    observer?.observe(element);
    window.addEventListener('resize', updateWidth);

    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updateWidth);
    };
  }, [elementRef]);

  return width;
}
