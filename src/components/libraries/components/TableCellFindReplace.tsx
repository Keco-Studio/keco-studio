'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { Modal } from 'antd';
import searchIcon from '@/assets/images/searchIcon.svg';
import type { AssetRow, PropertyConfig } from '@/lib/types/libraryAssets';
import { buildNormalizedIndexMap } from '@/lib/utils/cellValueReplace';
import { normalizeSearchString } from '@/lib/utils/normalizeSearchString';
import {
  useTableCellFindReplace,
  type TableCellSearchHit,
} from '@/components/libraries/hooks/useTableCellFindReplace';
import styles from './TableCellFindReplace.module.css';

type TableCellFindReplaceProps = {
  libraryId: string | undefined;
  rows: AssetRow[];
  properties: PropertyConfig[];
  canReplace: boolean;
  getAccessToken: () => Promise<string | undefined>;
  onHighlightCells: (cells: Array<{ assetId: string; fieldId: string }>) => void;
  onClearHighlight: () => void;
  scrollToCell?: (assetId: string, fieldId: string) => void;
};

function highlightMatch(text: string, query: string) {
  const q = query.trim();
  if (!q) return text;

  const { normalized, indexMap } = buildNormalizedIndexMap(text);
  const normalizedQuery = normalizeSearchString(q);
  if (!normalizedQuery) return text;

  const index = normalized.indexOf(normalizedQuery);
  if (index === -1 || indexMap.length === 0) return text;

  const start = indexMap[index];
  const end = indexMap[index + normalizedQuery.length - 1] + 1;

  return (
    <>
      {text.slice(0, start)}
      <span className={styles.hitHighlight}>{text.slice(start, end)}</span>
      {text.slice(end)}
    </>
  );
}

function truncateDisplay(text: string, maxLength = 72) {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

export function TableCellFindReplace({
  libraryId,
  rows,
  properties,
  canReplace,
  getAccessToken,
  onHighlightCells,
  onClearHighlight,
  scrollToCell,
}: TableCellFindReplaceProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  const {
    findText,
    setFindText,
    replaceText,
    setReplaceText,
    hits,
    pagedHits,
    page,
    setPage,
    totalPages,
    replaceModalOpen,
    setReplaceModalOpen,
    replaceLoading,
    replacePendingMode,
    replacePreview,
    openReplaceConfirm,
    confirmReplace,
    navigateToHit,
    clearSearch,
  } = useTableCellFindReplace({
    libraryId,
    rows,
    properties,
    getAccessToken,
    canReplace,
    onHighlightCells,
    onClearHighlight,
    scrollToCell,
  });

  useEffect(() => {
    if (!panelOpen) return;
    const handler = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setPanelOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [panelOpen]);

  const handleHitClick = useCallback(
    (hit: TableCellSearchHit) => {
      navigateToHit(hit);
    },
    [navigateToHit]
  );

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        type="button"
        className={`${styles.toggleButton} ${panelOpen ? styles.toggleButtonActive : ''}`}
        aria-label="Find and replace in this table"
        title="Find and replace in this table"
        onClick={(e) => {
          e.stopPropagation();
          setPanelOpen((open) => !open);
        }}
      >
        <Image src={searchIcon} alt="" width={18} height={18} />
      </button>

      {panelOpen && (
        <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
          <div className={styles.panelHeader}>
            <div className={styles.panelTitle}>Find in this table</div>
            <label className={styles.findRow}>
              <span className={styles.fieldLabel}>Find</span>
              <input
                type="text"
                className={styles.fieldInput}
                placeholder="Search cell values..."
                value={findText}
                autoFocus
                onChange={(e) => setFindText(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
              />
            </label>
            <label className={styles.replaceRow}>
              <span className={styles.fieldLabel}>Replace with</span>
              <input
                type="text"
                className={styles.fieldInput}
                placeholder="Replacement text"
                value={replaceText}
                onChange={(e) => setReplaceText(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
              />
            </label>
          </div>

          <div className={styles.resultsSection}>
            <div className={styles.resultsLabel}>Results</div>
            <div className={styles.resultsList}>
              {!findText.trim() ? (
                <div className={styles.emptyState}>Enter text to search this table.</div>
              ) : hits.length === 0 ? (
                <div className={styles.emptyState}>No matches in this table.</div>
              ) : (
                pagedHits.map((hit) => (
                  <div key={`${hit.assetId}-${hit.fieldId}`} className={styles.hitCard}>
                    <button
                      type="button"
                      className={styles.hitMain}
                      onClick={() => handleHitClick(hit)}
                    >
                      <div className={styles.hitFieldLabel} title={hit.fieldLabel}>
                        {hit.fieldLabel}
                      </div>
                      <div className={styles.hitValue}>
                        &quot;{highlightMatch(truncateDisplay(hit.valueDisplay), findText)}&quot;
                      </div>
                    </button>
                    {canReplace && (
                      <button
                        type="button"
                        className={styles.replaceOneButton}
                        disabled={!findText.trim()}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          openReplaceConfirm('single', hit);
                        }}
                      >
                        Replace
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {findText.trim().length > 0 && hits.length > 0 && (
            <div className={styles.footer}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                {canReplace ? (
                  <button
                    type="button"
                    className={styles.replaceAllButton}
                    disabled={!findText.trim()}
                    onClick={() => openReplaceConfirm('all')}
                  >
                    Replace all ({hits.length})
                  </button>
                ) : (
                  <span className={styles.pageLabel}>View only</span>
                )}
                <button
                  type="button"
                  className={styles.pageButton}
                  onClick={clearSearch}
                >
                  Clear
                </button>
              </div>
              <div className={styles.pagination}>
                <button
                  type="button"
                  className={styles.pageButton}
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Prev
                </button>
                <span className={styles.pageLabel}>
                  {page} / {totalPages}
                </span>
                <button
                  type="button"
                  className={styles.pageButton}
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  Next
                </button>
              </div>
            </div>
          )}

          {findText.trim().length > 0 && hits.length === 0 && (
            <div className={styles.footer}>
              <button type="button" className={styles.pageButton} onClick={clearSearch}>
                Clear
              </button>
            </div>
          )}
        </div>
      )}

      <Modal
        title={
          replacePendingMode === 'all'
            ? 'Replace all matching cells in this table'
            : 'Replace cell value'
        }
        open={replaceModalOpen}
        onCancel={() => {
          if (!replaceLoading) {
            setReplaceModalOpen(false);
          }
        }}
        onOk={confirmReplace}
        okText="Confirm replace"
        cancelText="Cancel"
        confirmLoading={replaceLoading}
        okButtonProps={{
          disabled:
            replaceLoading || !replacePreview || replacePreview.updated === 0,
        }}
      >
        {replaceLoading && !replacePreview ? (
          <p>Validating types...</p>
        ) : replacePreview ? (
          <div>
            <p>
              Cells containing &quot;{findText.trim()}&quot; will have their value set to &quot;
              {replaceText}&quot;.
            </p>
            <p>
              {replacePreview.updated} cell(s) will be updated, {replacePreview.skipped} skipped.
            </p>
            {replacePreview.previews.length > 0 && (
              <ul className={styles.previewList}>
                {replacePreview.previews.slice(0, 5).map((item, index) => (
                  <li key={`preview-${index}`}>
                    <strong>{item.fieldLabel}</strong>: &quot;{item.beforeDisplay}&quot; → &quot;
                    {item.afterDisplay}&quot;
                  </li>
                ))}
              </ul>
            )}
            {replacePreview.skips.length > 0 && (
              <ul className={styles.skipList}>
                {replacePreview.skips.slice(0, 5).map((item, index) => (
                  <li key={`skip-${index}`}>
                    <strong>{item.fieldLabel}</strong>: {item.reason}
                  </li>
                ))}
              </ul>
            )}
            <p className={styles.hint}>
              The full cell value is replaced, not just the matched text. Types are validated
              before save.
            </p>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
