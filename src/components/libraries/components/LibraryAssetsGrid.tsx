'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { AssetRow, PropertyConfig } from '@/lib/types/libraryAssets';
import assetTableIcon from '@/assets/images/AssetTableIcon.svg';
import {
  ASSET_GRID_SIZES,
  getAssetGridMetadata,
  getAssetGridPreviewUrl,
  getVisibleAssetFocusIndex,
  nextAssetGridSize,
  type AssetGridSizeIndex,
} from '@/components/libraries/utils/assetGridPresentation';
import styles from './LibraryAssetsGrid.module.css';

type LibraryAssetsGridProps = {
  rows: AssetRow[];
  properties: PropertyConfig[];
  sizeIndex: AssetGridSizeIndex;
  onSizeIndexChange: (sizeIndex: AssetGridSizeIndex) => void;
  selectedRowIds: Set<string>;
  onSelectionChange: (rowIds: Set<string>) => void;
  onOpenAsset: (row: AssetRow) => void;
  onAssetContextMenu?: (event: React.MouseEvent, row: AssetRow) => void;
};

const GRID_PADDING = 16;
const GRID_GAP = 12;
const ZOOM_GESTURE_INTERVAL_MS = 120;

function getCardName(row: AssetRow, properties: PropertyConfig[]): string {
  const name = row.name?.trim();
  if (name && name !== 'Untitled') return name;
  return getAssetGridMetadata(row, properties, 1)[0]?.value ?? name ?? 'Untitled';
}

export function LibraryAssetsGrid({
  rows,
  properties,
  sizeIndex,
  onSizeIndexChange,
  selectedRowIds,
  onSelectionChange,
  onOpenAsset,
  onAssetContextMenu,
}: LibraryAssetsGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastZoomAtRef = useRef(0);
  const [containerWidth, setContainerWidth] = useState(0);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [failedPreviewKeys, setFailedPreviewKeys] = useState<Set<string>>(new Set());
  const size = ASSET_GRID_SIZES[sizeIndex] ?? ASSET_GRID_SIZES[2];
  const cardHeight = size.tileWidth + 48 + size.metadataLimit * 20;
  const columnCount = Math.max(
    1,
    Math.floor((containerWidth - GRID_PADDING * 2 + GRID_GAP) / (size.tileWidth + GRID_GAP)),
  );
  const rowCount = Math.ceil(rows.length / columnCount);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    const updateWidth = () => setContainerWidth(element.clientWidth);
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const rowVirtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => cardHeight + GRID_GAP,
    overscan: 3,
  });

  useEffect(() => {
    rowVirtualizer.measure();
  }, [cardHeight, columnCount, rowVirtualizer]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();

      const now = Date.now();
      if (now - lastZoomAtRef.current < ZOOM_GESTURE_INTERVAL_MS) return;
      lastZoomAtRef.current = now;
      onSizeIndexChange(nextAssetGridSize(sizeIndex, event.deltaY));
    };

    element.addEventListener('wheel', handleWheel, { passive: false });
    return () => element.removeEventListener('wheel', handleWheel);
  }, [onSizeIndexChange, sizeIndex]);

  const virtualRows = rowVirtualizer.getVirtualItems();
  const firstVirtualRow = virtualRows[0];
  const lastVirtualRow = virtualRows[virtualRows.length - 1];
  const firstVisibleAssetIndex = firstVirtualRow ? firstVirtualRow.index * columnCount : 0;
  const lastVisibleAssetIndex = lastVirtualRow
    ? Math.min(rows.length - 1, (lastVirtualRow.index + 1) * columnCount - 1)
    : -1;
  const visibleFocusedIndex = getVisibleAssetFocusIndex(
    focusedIndex,
    firstVisibleAssetIndex,
    lastVisibleAssetIndex,
  );
  const orderedProperties = useMemo(
    () => [...properties].sort((left, right) => left.orderIndex - right.orderIndex),
    [properties],
  );

  const changeSize = useCallback((delta: number) => {
    onSizeIndexChange(
      Math.min(ASSET_GRID_SIZES.length - 1, Math.max(0, sizeIndex + delta)),
    );
  }, [onSizeIndexChange, sizeIndex]);

  const selectAsset = useCallback((assetId: string, event: React.MouseEvent) => {
    if (event.ctrlKey || event.metaKey) {
      const next = new Set(selectedRowIds);
      if (next.has(assetId)) next.delete(assetId);
      else next.add(assetId);
      onSelectionChange(next);
      return;
    }
    onSelectionChange(new Set([assetId]));
  }, [onSelectionChange, selectedRowIds]);

  const focusAssetAt = useCallback((nextIndex: number) => {
    if (rows.length === 0) return;
    const index = Math.min(rows.length - 1, Math.max(0, nextIndex));
    const asset = rows[index];
    setFocusedIndex(index);
    onSelectionChange(new Set([asset.id]));
    rowVirtualizer.scrollToIndex(Math.floor(index / columnCount), { align: 'auto' });
    window.requestAnimationFrame(() => {
      scrollRef.current
        ?.querySelector<HTMLButtonElement>(`[data-asset-index="${index}"]`)
        ?.focus();
    });
  }, [columnCount, onSelectionChange, rowVirtualizer, rows]);

  useEffect(() => {
    if (rows.length === 0) {
      setFocusedIndex(0);
      return;
    }
    setFocusedIndex((current) => Math.min(current, rows.length - 1));
  }, [rows.length]);

  return (
    <div className={styles.shell}>
      <div
        ref={scrollRef}
        className={styles.scroller}
        data-testid="library-assets-grid"
        role="grid"
        aria-label="Assets"
        aria-rowcount={rowCount}
        aria-colcount={columnCount}
        onClick={(event) => {
          const target = event.target as Element;
          if (!target.closest('[data-asset-card]')) onSelectionChange(new Set());
        }}
      >
        {rows.length === 0 ? (
          <div className={styles.emptyState}>No assets</div>
        ) : (
          <div
            className={styles.virtualCanvas}
            style={{ height: rowVirtualizer.getTotalSize() + GRID_PADDING * 2 }}
          >
            {virtualRows.map((virtualRow) => {
              const startIndex = virtualRow.index * columnCount;
              const items = rows.slice(startIndex, startIndex + columnCount);
              return (
                <div
                  key={virtualRow.key}
                  ref={rowVirtualizer.measureElement}
                  data-index={virtualRow.index}
                  role="row"
                  aria-rowindex={virtualRow.index + 1}
                  className={styles.virtualRow}
                  style={{
                    gridTemplateColumns: `repeat(${columnCount}, ${size.tileWidth}px)`,
                    minHeight: cardHeight,
                    transform: `translateY(${virtualRow.start + GRID_PADDING}px)`,
                  }}
                >
                  {items.map((row, columnIndex) => {
                    const assetIndex = startIndex + columnIndex;
                    const previewUrl = getAssetGridPreviewUrl(row, orderedProperties);
                    const previewKey = previewUrl ? `${row.id}:${previewUrl}` : null;
                    const showPreview = Boolean(
                      previewUrl && previewKey && !failedPreviewKeys.has(previewKey),
                    );
                    const metadata = getAssetGridMetadata(
                      row,
                      orderedProperties,
                      size.metadataLimit,
                    );
                    const selected = selectedRowIds.has(row.id);
                    return (
                      <button
                        key={row.id}
                        type="button"
                        role="gridcell"
                        data-asset-card
                        data-asset-index={assetIndex}
                        aria-selected={selected}
                        aria-rowindex={virtualRow.index + 1}
                        aria-colindex={columnIndex + 1}
                        tabIndex={assetIndex === visibleFocusedIndex ? 0 : -1}
                        className={`${styles.card} ${selected ? styles.cardSelected : ''}`}
                        style={{ width: size.tileWidth, minHeight: cardHeight }}
                        onClick={(event) => {
                          setFocusedIndex(assetIndex);
                          selectAsset(row.id, event);
                        }}
                        onFocus={() => setFocusedIndex(assetIndex)}
                        onDoubleClick={(event) => {
                          event.stopPropagation();
                          onOpenAsset(row);
                        }}
                        onContextMenu={(event) => onAssetContextMenu?.(event, row)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            onOpenAsset(row);
                            return;
                          }

                          let nextIndex: number | null = null;
                          if (event.key === 'ArrowLeft') nextIndex = assetIndex - 1;
                          if (event.key === 'ArrowRight') nextIndex = assetIndex + 1;
                          if (event.key === 'ArrowUp') nextIndex = assetIndex - columnCount;
                          if (event.key === 'ArrowDown') nextIndex = assetIndex + columnCount;
                          if (event.key === 'Home') nextIndex = 0;
                          if (event.key === 'End') nextIndex = rows.length - 1;
                          if (nextIndex === null) return;
                          event.preventDefault();
                          focusAssetAt(nextIndex);
                        }}
                      >
                        <span className={styles.preview} style={{ height: size.tileWidth }}>
                          {showPreview && previewUrl ? (
                            // Supabase and imported asset URLs are dynamic, so bypass Next's host allowlist.
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              className={styles.previewImage}
                              src={previewUrl}
                              alt=""
                              onError={() => {
                                if (!previewKey) return;
                                setFailedPreviewKeys((current) => new Set(current).add(previewKey));
                              }}
                            />
                          ) : (
                            <Image
                              className={styles.fallbackIcon}
                              src={assetTableIcon}
                              alt=""
                              width={Math.max(36, Math.round(size.tileWidth * 0.42))}
                              height={Math.max(36, Math.round(size.tileWidth * 0.42))}
                            />
                          )}
                        </span>
                        <span className={styles.name} title={getCardName(row, orderedProperties)}>
                          {getCardName(row, orderedProperties)}
                        </span>
                        {metadata.length > 0 ? (
                          <span className={styles.metadata}>
                            {metadata.map((item) => (
                              <span className={styles.metadataRow} key={`${row.id}-${item.label}`}>
                                <span className={styles.metadataLabel}>{item.label}</span>
                                <span className={styles.metadataValue}>{item.value}</span>
                              </span>
                            ))}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className={styles.zoomControls} aria-label="Asset size">
        <button
          type="button"
          className={styles.zoomButton}
          aria-label="Decrease asset size"
          title="Decrease asset size"
          disabled={sizeIndex === 0}
          onClick={() => changeSize(-1)}
        >
          -
        </button>
        <span className={styles.zoomValue}>{size.label}</span>
        <button
          type="button"
          className={styles.zoomButton}
          aria-label="Increase asset size"
          title="Increase asset size"
          disabled={sizeIndex === ASSET_GRID_SIZES.length - 1}
          onClick={() => changeSize(1)}
        >
          +
        </button>
      </div>
    </div>
  );
}
