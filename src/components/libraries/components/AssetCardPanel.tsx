'use client';

import { createPortal } from 'react-dom';
import styles from '@/components/libraries/LibraryAssetsTable.module.css';

export type AssetCardDetails = {
  name: string;
  libraryId: string;
  libraryName: string;
  firstColumnLabel?: string;
  selectedCells?: Array<{ fieldLabel: string; displayValue: string }>;
  /** Source library no longer exists — show empty-state copy instead of details. */
  sourceLibraryDeleted?: boolean;
};

export type AssetCardPanelProps = {
  visible: boolean;
  position: { x: number; y: number };
  assetId: string | null;
  details: AssetCardDetails | null;
  onClose: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onLibraryClick?: (libraryId: string) => void;
  containerRef?: (el: HTMLElement | null) => void;
};

function ExternalLinkIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`icon-16 ${styles.assetCardLibraryArrow}`}
      aria-hidden
    >
      <path
        d="M4.66675 11.3337L11.3334 4.66699"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4.66675 4.66699H11.3334V11.3337"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function AssetCardPanel({
  visible,
  position,
  details,
  onMouseEnter,
  onMouseLeave,
  onLibraryClick,
  containerRef,
}: AssetCardPanelProps) {
  if (!visible || !position || typeof document === 'undefined') return null;

  const { x, y } = position;
  const detailRows =
    details?.selectedCells && details.selectedCells.length > 0
      ? details.selectedCells
      : details
        ? [{ fieldLabel: details.firstColumnLabel || 'Name', displayValue: details.name || 'Untitled' }]
        : [];

  return createPortal(
    <div ref={containerRef as React.Ref<HTMLDivElement>} style={{ display: 'contents' }}>
      <div
        className={styles.assetCardPanel}
        style={{ left: `${x}px`, top: `${y}px` }}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        <div className={styles.assetCardContent}>
          {details?.sourceLibraryDeleted ? (
            <div className={styles.assetCardDeletedMessage}>
              The source library has been deleted.
            </div>
          ) : details ? (
            <div className={styles.assetCardDetailsSection}>
              <div className={styles.assetCardKvList}>
                {detailRows.map((cell, idx) => (
                  <div key={`${cell.fieldLabel}-${idx}`} className={styles.assetCardKvRow}>
                    <span className={styles.assetCardKvLabel}>{cell.fieldLabel || 'Field'}</span>
                    <span className={styles.assetCardKvValue}>{cell.displayValue || '-'}</span>
                  </div>
                ))}
                {details.libraryId ? (
                  <div className={styles.assetCardKvRow}>
                    <span className={styles.assetCardKvLabel}>From</span>
                    <button
                      type="button"
                      className={styles.assetCardFromLink}
                      onClick={() => onLibraryClick?.(details.libraryId)}
                      disabled={!onLibraryClick}
                    >
                      <span>{details.libraryName || 'Library'}</span>
                      <ExternalLinkIcon />
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>,
    document.body
  );
}
