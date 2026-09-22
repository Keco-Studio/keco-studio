'use client';

import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import styles from '../LibraryAssetsTable.module.css';
import { resolveHorizontalOverflow } from './stickyHorizontalScrollbarState';

type StickyHorizontalScrollbarProps = {
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  /** Auto-sized tables know whether their calculated columns exceed the viewport. */
  knownOverflow?: boolean;
};

export function StickyHorizontalScrollbar({
  scrollContainerRef,
  knownOverflow,
}: StickyHorizontalScrollbarProps) {
  const scrollbarRef = useRef<HTMLDivElement>(null);
  const spacerRef = useRef<HTMLDivElement>(null);
  const [hasOverflow, setHasOverflow] = useState(false);

  useLayoutEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    const scrollbar = scrollbarRef.current;
    const spacer = spacerRef.current;
    if (!scrollContainer || !scrollbar || !spacer) return;

    const updateDimensions = () => {
      const nextHasOverflow = resolveHorizontalOverflow(
        scrollContainer.scrollWidth,
        scrollContainer.clientWidth,
        knownOverflow,
      );
      spacer.style.width = `${scrollContainer.scrollWidth}px`;
      setHasOverflow((current) =>
        current === nextHasOverflow ? current : nextHasOverflow
      );
      if (scrollbar.scrollLeft !== scrollContainer.scrollLeft) {
        scrollbar.scrollLeft = scrollContainer.scrollLeft;
      }
    };

    const syncFromTable = () => {
      if (scrollbar.scrollLeft !== scrollContainer.scrollLeft) {
        scrollbar.scrollLeft = scrollContainer.scrollLeft;
      }
    };
    const syncFromScrollbar = () => {
      if (scrollContainer.scrollLeft !== scrollbar.scrollLeft) {
        scrollContainer.scrollLeft = scrollbar.scrollLeft;
      }
    };

    scrollContainer.addEventListener('scroll', syncFromTable, { passive: true });
    scrollbar.addEventListener('scroll', syncFromScrollbar, { passive: true });
    window.addEventListener('resize', updateDimensions);

    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(updateDimensions);
    resizeObserver?.observe(scrollContainer);
    if (scrollContainer.firstElementChild instanceof HTMLElement) {
      resizeObserver?.observe(scrollContainer.firstElementChild);
    }

    updateDimensions();

    return () => {
      scrollContainer.removeEventListener('scroll', syncFromTable);
      scrollbar.removeEventListener('scroll', syncFromScrollbar);
      window.removeEventListener('resize', updateDimensions);
      resizeObserver?.disconnect();
    };
  }, [knownOverflow, scrollContainerRef]);

  return (
    <div
      ref={scrollbarRef}
      className={`${styles.stickyHorizontalScrollbar} ${
        hasOverflow ? '' : styles.stickyHorizontalScrollbarHidden
      }`}
      aria-hidden="true"
    >
      <div ref={spacerRef} className={styles.stickyHorizontalScrollbarContent} />
    </div>
  );
}
