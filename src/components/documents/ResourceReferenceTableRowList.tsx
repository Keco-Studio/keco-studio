'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cellDisplayString } from '@/lib/utils/assetEmptiness';
import styles from './ResourceReferencePickerModal.module.css';

export type ResourceReferenceTableField = {
  id: string;
  label: string;
};

export type ResourceReferenceTableRow = {
  id: string;
  values: Record<string, unknown>;
};

export type ResourceReferenceTableRowListProps = {
  ariaLabel: string;
  idPrefix: string;
  fields: readonly ResourceReferenceTableField[];
  rows: readonly ResourceReferenceTableRow[];
  selectedIds: ReadonlySet<string>;
  singleSelect: boolean;
  emptyText: string;
  onToggle: (id: string) => void;
  onToggleAll?: (selectAll: boolean) => void;
};

export function ResourceReferenceTableRowList({
  ariaLabel,
  idPrefix,
  fields,
  rows,
  selectedIds,
  singleSelect,
  emptyText,
  onToggle,
  onToggleAll,
}: ResourceReferenceTableRowListProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const optionElements = useRef(new Map<string, HTMLTableRowElement>());
  const itemIds = useMemo(() => rows.map((row) => row.id), [rows]);
  const firstSelectedIndex = itemIds.findIndex((id) => selectedIds.has(id));
  const storedActiveIndex = activeId ? itemIds.indexOf(activeId) : -1;
  const activeIndex = storedActiveIndex >= 0
    ? storedActiveIndex
    : firstSelectedIndex >= 0
      ? firstSelectedIndex
      : rows.length > 0 ? 0 : -1;
  const resolvedActiveId = activeIndex >= 0 ? itemIds[activeIndex] : null;
  const activeDomId = resolvedActiveId ? `${idPrefix}-${resolvedActiveId}` : undefined;
  const allSelected = rows.length > 0 && rows.every((row) => selectedIds.has(row.id));

  useEffect(() => {
    setActiveId(resolvedActiveId);
  }, [resolvedActiveId]);

  useEffect(() => {
    if (!resolvedActiveId) return;
    optionElements.current.get(resolvedActiveId)?.scrollIntoView({ block: 'nearest' });
  }, [resolvedActiveId]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (rows.length === 0) return;
    let nextIndex = activeIndex;
    switch (event.key) {
      case 'ArrowDown':
        nextIndex = Math.min(activeIndex + 1, rows.length - 1);
        break;
      case 'ArrowUp':
        nextIndex = Math.max(activeIndex - 1, 0);
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = rows.length - 1;
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (activeIndex >= 0) onToggle(rows[activeIndex].id);
        return;
      default:
        return;
    }
    event.preventDefault();
    setActiveId(itemIds[nextIndex]);
  }, [activeIndex, itemIds, onToggle, rows]);

  return (
    <div
      className={styles.tableScroll}
      role="listbox"
      tabIndex={0}
      aria-label={ariaLabel}
      aria-multiselectable={!singleSelect}
      aria-activedescendant={activeDomId}
      onKeyDown={handleKeyDown}
    >
      {rows.length === 0 ? (
        <div className={styles.emptyResult}>{emptyText}</div>
      ) : (
        <table className={styles.referenceTable}>
          <thead>
            <tr>
              <th className={styles.checkboxCell} scope="col">
                {!singleSelect && onToggleAll ? (
                  <input
                    type="checkbox"
                    className={styles.headerCheckbox}
                    checked={allSelected}
                    ref={(element) => {
                      if (element) element.indeterminate = false;
                    }}
                    aria-label="Select all rows"
                    onChange={(event) => onToggleAll(event.target.checked)}
                    onClick={(event) => event.stopPropagation()}
                  />
                ) : null}
              </th>
              {fields.map((field) => (
                <th key={field.id} scope="col">{field.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const selected = selectedIds.has(row.id);
              const active = row.id === resolvedActiveId;
              const rowLabel = fields
                .map((field) => cellDisplayString(row.values[field.id]))
                .filter(Boolean)
                .join(' · ') || '(empty)';
              return (
                <tr
                  key={row.id}
                  ref={(element) => {
                    if (element) optionElements.current.set(row.id, element);
                    else optionElements.current.delete(row.id);
                  }}
                  id={`${idPrefix}-${row.id}`}
                  className={selected
                    ? styles.selectedTableRow
                    : active ? styles.activeTableRow : undefined}
                  role="option"
                  tabIndex={-1}
                  aria-label={`Row: ${rowLabel}`}
                  aria-selected={selected}
                  aria-checked={selected}
                  onMouseMove={() => setActiveId(row.id)}
                  onClick={() => {
                    setActiveId(row.id);
                    onToggle(row.id);
                  }}
                >
                  <td className={styles.checkboxCell}>
                    <input
                      type="checkbox"
                      className={styles.rowCheckbox}
                      checked={selected}
                      readOnly
                      tabIndex={-1}
                      aria-hidden="true"
                    />
                  </td>
                  {fields.map((field) => (
                    <td key={field.id}>
                      {cellDisplayString(row.values[field.id]) || '—'}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
