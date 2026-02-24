import { useRef, useCallback, useEffect } from 'react';
import type { AssetRow, PropertyConfig } from '@/lib/types/libraryAssets';

export type SelectionBounds = {
  minRowIndex: number;
  maxRowIndex: number;
  minPropertyIndex: number;
  maxPropertyIndex: number;
  rowIds: string[];
  propertyKeys: string[];
};

export type BorderClassNames = {
  cutBorderTop: string;
  cutBorderBottom: string;
  cutBorderLeft: string;
  cutBorderRight: string;
  copyBorderTop: string;
  copyBorderBottom: string;
  copyBorderLeft: string;
  copyBorderRight: string;
};

export type UseTableMenuPositionParams = {
  tableContainerRef: React.RefObject<HTMLDivElement | null>;
  batchEditMenuVisible: boolean;
  setBatchEditMenuVisible: (v: boolean) => void;
  setBatchEditMenuPosition: React.Dispatch<React.SetStateAction<{ x: number; y: number } | null>>;
  cutSelectionBounds: SelectionBounds | null;
  copySelectionBounds: SelectionBounds | null;
  cutCells: Set<string>;
  copyCells: Set<string>;
  orderedProperties: PropertyConfig[];
  getAllRowsForCellSelection: () => AssetRow[];
  borderClassNames: BorderClassNames;
};

export function useTableMenuPosition(params: UseTableMenuPositionParams) {
  const {
    tableContainerRef,
    batchEditMenuVisible,
    setBatchEditMenuVisible,
    setBatchEditMenuPosition,
    cutSelectionBounds,
    copySelectionBounds,
    cutCells,
    copyCells,
    orderedProperties,
    getAllRowsForCellSelection,
    borderClassNames,
  } = params;

  const batchEditMenuOriginalPositionRef = useRef<{
    x: number;
    y: number;
    scrollY: number;
  } | null>(null);

  const getCurrentScrollY = useCallback(() => {
    const tableContainer = tableContainerRef.current;
    if (!tableContainer) {
      return typeof window !== 'undefined' ? (window.scrollY ?? window.pageYOffset ?? 0) : 0;
    }
    const containerStyle = window.getComputedStyle(tableContainer);
    const hasOverflow =
      containerStyle.overflow === 'auto' ||
      containerStyle.overflow === 'scroll' ||
      containerStyle.overflowY === 'auto' ||
      containerStyle.overflowY === 'scroll';
    if (hasOverflow && tableContainer.scrollHeight > tableContainer.clientHeight) {
      return tableContainer.scrollTop;
    }
    let el: HTMLElement | null = tableContainer.parentElement;
    while (el && el !== document.body) {
      const style = window.getComputedStyle(el);
      const ho =
        style.overflow === 'auto' ||
        style.overflow === 'scroll' ||
        style.overflowY === 'auto' ||
        style.overflowY === 'scroll';
      if (ho && el.scrollHeight > el.clientHeight) return el.scrollTop;
      el = el.parentElement;
    }
    return typeof window !== 'undefined' ? (window.scrollY ?? window.pageYOffset ?? 0) : 0;
  }, [tableContainerRef]);

  const adjustMenuPosition = useCallback((x: number, y: number, _menuHeight = 400): { x: number; y: number } => {
    const windowWidth = typeof window !== 'undefined' ? window.innerWidth : 0;
    const padding = 10;
    const menuWidth = 180;
    let adjustedX = x;
    if (x + menuWidth > windowWidth - padding) {
      adjustedX = Math.max(padding, windowWidth - menuWidth - padding);
    }
    return { x: adjustedX, y };
  }, []);

  const getCutBorderClasses = useCallback(
    (rowId: string, propertyIndex: number): string => {
      const prop = orderedProperties[propertyIndex];
      if (!prop || !cutSelectionBounds || !cutCells.has(`${rowId}-${prop.key}`)) return '';
      const allRows = getAllRowsForCellSelection();
      const rowIndex = allRows.findIndex((r) => r.id === rowId);
      if (rowIndex === -1) return '';
      const { minRowIndex, maxRowIndex, minPropertyIndex, maxPropertyIndex } = cutSelectionBounds;
      const classes: string[] = [];
      if (rowIndex === minRowIndex) classes.push(borderClassNames.cutBorderTop);
      if (rowIndex === maxRowIndex) classes.push(borderClassNames.cutBorderBottom);
      if (propertyIndex === minPropertyIndex) classes.push(borderClassNames.cutBorderLeft);
      if (propertyIndex === maxPropertyIndex) classes.push(borderClassNames.cutBorderRight);
      return classes.join(' ');
    },
    [
      cutSelectionBounds,
      cutCells,
      orderedProperties,
      getAllRowsForCellSelection,
      borderClassNames.cutBorderTop,
      borderClassNames.cutBorderBottom,
      borderClassNames.cutBorderLeft,
      borderClassNames.cutBorderRight,
    ]
  );

  const getCopyBorderClasses = useCallback(
    (rowId: string, propertyIndex: number): string => {
      const prop = orderedProperties[propertyIndex];
      if (!prop || !copySelectionBounds || !copyCells.has(`${rowId}-${prop.key}`)) return '';
      const allRows = getAllRowsForCellSelection();
      const rowIndex = allRows.findIndex((r) => r.id === rowId);
      if (rowIndex === -1) return '';
      const { minRowIndex, maxRowIndex, minPropertyIndex, maxPropertyIndex } = copySelectionBounds;
      const classes: string[] = [];
      if (rowIndex === minRowIndex) classes.push(borderClassNames.copyBorderTop);
      if (rowIndex === maxRowIndex) classes.push(borderClassNames.copyBorderBottom);
      if (propertyIndex === minPropertyIndex) classes.push(borderClassNames.copyBorderLeft);
      if (propertyIndex === maxPropertyIndex) classes.push(borderClassNames.copyBorderRight);
      return classes.join(' ');
    },
    [
      copySelectionBounds,
      copyCells,
      orderedProperties,
      getAllRowsForCellSelection,
      borderClassNames.copyBorderTop,
      borderClassNames.copyBorderBottom,
      borderClassNames.copyBorderLeft,
      borderClassNames.copyBorderRight,
    ]
  );

  useEffect(() => {
    if (!batchEditMenuVisible) return;
    const onOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest?.('.batchEditMenu')) {
        setBatchEditMenuVisible(false);
        setBatchEditMenuPosition(null);
        batchEditMenuOriginalPositionRef.current = null;
      }
    };
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setBatchEditMenuVisible(false);
        setBatchEditMenuPosition(null);
        batchEditMenuOriginalPositionRef.current = null;
      }
    };
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('mousedown', onOutside);
      document.removeEventListener('keydown', onEscape);
    };
  }, [batchEditMenuVisible, setBatchEditMenuVisible, setBatchEditMenuPosition]);

  useEffect(() => {
    if (!batchEditMenuVisible) batchEditMenuOriginalPositionRef.current = null;
  }, [batchEditMenuVisible]);

  useEffect(() => {
    if (!batchEditMenuVisible || !batchEditMenuOriginalPositionRef.current) return;
    const update = () => {
      const orig = batchEditMenuOriginalPositionRef.current;
      if (!orig) return;
      const scrollY = getCurrentScrollY();
      const delta = scrollY - (orig.scrollY ?? 0);
      setBatchEditMenuPosition({ x: orig.x, y: orig.y - delta });
    };
    const scrollElements: (HTMLElement | Window)[] = [];
    const tc = tableContainerRef.current;
    if (tc) {
      scrollElements.push(tc);
      let el: HTMLElement | null = tc.parentElement;
      while (el && el !== document.body) {
        const s = window.getComputedStyle(el);
        const ho = s.overflow === 'auto' || s.overflow === 'scroll' || s.overflowY === 'auto' || s.overflowY === 'scroll';
        if (ho) scrollElements.push(el);
        el = el.parentElement;
      }
    }
    scrollElements.push(window);
    scrollElements.forEach((el) => el.addEventListener('scroll', update, true));
    return () => scrollElements.forEach((el) => el.removeEventListener('scroll', update, true));
  }, [batchEditMenuVisible, getCurrentScrollY, setBatchEditMenuPosition, tableContainerRef]);

  return {
    getCurrentScrollY,
    adjustMenuPosition,
    getCutBorderClasses,
    getCopyBorderClasses,
    batchEditMenuOriginalPositionRef,
  };
}
