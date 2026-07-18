'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styles from './ResourceReferencePickerModal.module.css';

export type ResourceReferenceResultListProps<T> = {
  ariaLabel: string;
  idPrefix: string;
  items: readonly T[];
  selectedId: string | null;
  emptyText: string;
  getId: (item: T) => string;
  getTitle: (item: T) => string;
  getDescription: (item: T) => string;
  getAriaLabel: (item: T) => string;
  onSelect: (item: T) => void;
};

export function ResourceReferenceResultList<T>({
  ariaLabel,
  idPrefix,
  items,
  selectedId,
  emptyText,
  getId,
  getTitle,
  getDescription,
  getAriaLabel,
  onSelect,
}: ResourceReferenceResultListProps<T>) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const optionElements = useRef(new Map<string, HTMLDivElement>());
  const itemIds = useMemo(() => items.map(getId), [getId, items]);
  const selectedIndex = selectedId ? itemIds.indexOf(selectedId) : -1;
  const storedActiveIndex = activeId ? itemIds.indexOf(activeId) : -1;
  const activeIndex = storedActiveIndex >= 0
    ? storedActiveIndex
    : selectedIndex >= 0
      ? selectedIndex
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
        if (activeIndex >= 0) onSelect(items[activeIndex]);
        return;
      default:
        return;
    }
    event.preventDefault();
    setActiveId(itemIds[nextIndex]);
  }, [activeIndex, itemIds, items, onSelect]);

  return (
    <div
      className={styles.resultList}
      role="listbox"
      tabIndex={0}
      aria-label={ariaLabel}
      aria-multiselectable={false}
      aria-activedescendant={activeDomId}
      onKeyDown={handleKeyDown}
    >
      {items.length === 0 ? (
        <div className={styles.emptyResult}>{emptyText}</div>
      ) : items.map((item) => {
        const id = getId(item);
        const selected = id === selectedId;
        const active = id === resolvedActiveId;
        return (
          <div
            key={id}
            ref={(element) => {
              if (element) optionElements.current.set(id, element);
              else optionElements.current.delete(id);
            }}
            id={`${idPrefix}-${id}`}
            className={selected
              ? styles.selectedRow
              : active ? styles.activeRow : styles.resultRow}
            role="option"
            tabIndex={-1}
            aria-label={getAriaLabel(item)}
            aria-selected={selected}
            onMouseMove={() => setActiveId(id)}
            onClick={() => {
              setActiveId(id);
              onSelect(item);
            }}
          >
            <div className={styles.resultTitle}>{getTitle(item)}</div>
            <div className={styles.resultDescription}>{getDescription(item)}</div>
          </div>
        );
      })}
    </div>
  );
}
