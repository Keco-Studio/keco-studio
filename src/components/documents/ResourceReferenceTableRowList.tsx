'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styles from './ResourceReferencePickerModal.module.css';

export type ResourceReferenceTableRowListProps = {
  ariaLabel: string;
  idPrefix: string;
  items: readonly { id: string; label: string }[];
  selectedIds: ReadonlySet<string>;
  singleSelect: boolean;
  emptyText: string;
  onToggle: (id: string) => void;
};

export function ResourceReferenceTableRowList({
  ariaLabel,
  idPrefix,
  items,
  selectedIds,
  singleSelect,
  emptyText,
  onToggle,
}: ResourceReferenceTableRowListProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const optionElements = useRef(new Map<string, HTMLDivElement>());
  const itemIds = useMemo(() => items.map((item) => item.id), [items]);
  const firstSelectedIndex = itemIds.findIndex((id) => selectedIds.has(id));
  const storedActiveIndex = activeId ? itemIds.indexOf(activeId) : -1;
  const activeIndex = storedActiveIndex >= 0
    ? storedActiveIndex
    : firstSelectedIndex >= 0
      ? firstSelectedIndex
      : items.length > 0 ? 0 : -1;
  const resolvedActiveId = activeIndex >= 0 ? itemIds[activeIndex] : null;
  const activeDomId = resolvedActiveId ? `${idPrefix}-${resolvedActiveId}` : undefined;

  useEffect(() => {
    setActiveId(resolvedActiveId);
  }, [resolvedActiveId]);

  useEffect(() => {
    if (!resolvedActiveId) return;
    optionElements.current.get(resolvedActiveId)?.scrollIntoView({ block: 'nearest' });
  }, [resolvedActiveId]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (items.length === 0) return;
    let nextIndex = activeIndex;
    switch (event.key) {
      case 'ArrowDown':
        nextIndex = Math.min(activeIndex + 1, items.length - 1);
        break;
      case 'ArrowUp':
        nextIndex = Math.max(activeIndex - 1, 0);
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = items.length - 1;
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (activeIndex >= 0) onToggle(items[activeIndex].id);
        return;
      default:
        return;
    }
    event.preventDefault();
    setActiveId(itemIds[nextIndex]);
  }, [activeIndex, itemIds, items, onToggle]);

  return (
    <div
      className={styles.resultList}
      role="listbox"
      tabIndex={0}
      aria-label={ariaLabel}
      aria-multiselectable={!singleSelect}
      aria-activedescendant={activeDomId}
      onKeyDown={handleKeyDown}
    >
      {items.length === 0 ? (
        <div className={styles.emptyResult}>{emptyText}</div>
      ) : items.map((item) => {
        const selected = selectedIds.has(item.id);
        const active = item.id === resolvedActiveId;
        return (
          <div
            key={item.id}
            ref={(element) => {
              if (element) optionElements.current.set(item.id, element);
              else optionElements.current.delete(item.id);
            }}
            id={`${idPrefix}-${item.id}`}
            className={selected
              ? styles.selectedRow
              : active ? styles.activeRow : styles.resultRow}
            role="option"
            tabIndex={-1}
            aria-label={`Row: ${item.label}`}
            aria-selected={selected}
            aria-checked={selected}
            onMouseMove={() => setActiveId(item.id)}
            onClick={() => {
              setActiveId(item.id);
              onToggle(item.id);
            }}
          >
            <input
              type="checkbox"
              className={styles.rowCheckbox}
              checked={selected}
              readOnly
              tabIndex={-1}
              aria-hidden="true"
            />
            <div className={styles.resultTitle}>{item.label}</div>
          </div>
        );
      })}
    </div>
  );
}
