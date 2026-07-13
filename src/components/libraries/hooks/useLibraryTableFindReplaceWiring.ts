import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PropertyGroup } from '../utils/tableStructure';

export type TableCellScrollTarget = {
  assetId: string;
  fieldId: string;
  requestId: number;
};

type UseLibraryTableFindReplaceWiringArgs = {
  libraryId?: string;
  groups: PropertyGroup[];
  sectionStateStorageKey: string;
  focusSectionIdFromQuery: string | null;
  focusAssetIdFromQuery: string | null;
  focusFieldIdFromQuery: string | null;
  setActiveSectionId: React.Dispatch<React.SetStateAction<string | null>>;
};

export function useLibraryTableFindReplaceWiring({
  libraryId,
  groups,
  sectionStateStorageKey,
  focusSectionIdFromQuery,
  focusAssetIdFromQuery,
  focusFieldIdFromQuery,
  setActiveSectionId,
}: UseLibraryTableFindReplaceWiringArgs) {
  const [searchHighlightedCells, setSearchHighlightedCells] = useState<
    Array<{ assetId: string; fieldId: string }>
  >([]);
  const [scrollTargetCell, setScrollTargetCell] = useState<TableCellScrollTarget | null>(null);
  const appliedFocusSectionRef = useRef<string | null>(null);
  const appliedFocusCellRef = useRef<string | null>(null);
  const scrollRequestIdRef = useRef(0);

  const searchHighlightedCellKeys = useMemo(
    () => new Set(searchHighlightedCells.map(({ assetId, fieldId }) => `${assetId}:${fieldId}`)),
    [searchHighlightedCells]
  );

  const requestCellScroll = useCallback((assetId: string, fieldId: string) => {
    scrollRequestIdRef.current += 1;
    setScrollTargetCell({ assetId, fieldId, requestId: scrollRequestIdRef.current });
  }, []);

  const clearSearchCellHighlight = useCallback(() => {
    setSearchHighlightedCells([]);
    appliedFocusCellRef.current = null;
  }, []);

  useEffect(() => {
    const handleHighlightClear = () => clearSearchCellHighlight();
    const handleCellValuesReplaced = (event: Event) => {
      const custom = event as CustomEvent<{ libraryId?: string }>;
      if (custom.detail?.libraryId && custom.detail.libraryId !== libraryId) return;
      clearSearchCellHighlight();
    };
    if (typeof window === 'undefined') return;
    window.addEventListener('libraryCellSearchHighlightClear', handleHighlightClear);
    window.addEventListener('libraryCellValuesReplaced', handleCellValuesReplaced);
    return () => {
      window.removeEventListener('libraryCellSearchHighlightClear', handleHighlightClear);
      window.removeEventListener('libraryCellValuesReplaced', handleCellValuesReplaced);
    };
  }, [clearSearchCellHighlight, libraryId]);

  useEffect(() => {
    if (!focusSectionIdFromQuery) return;
    if (groups.length === 0) return;
    if (appliedFocusSectionRef.current === focusSectionIdFromQuery) return;
    const exists = groups.some((group) => group.section.id === focusSectionIdFromQuery);
    if (!exists) return;
    setActiveSectionId(focusSectionIdFromQuery);
    appliedFocusSectionRef.current = focusSectionIdFromQuery;
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(sectionStateStorageKey, focusSectionIdFromQuery);
    }
  }, [focusSectionIdFromQuery, groups, sectionStateStorageKey, setActiveSectionId]);

  useEffect(() => {
    if (!focusAssetIdFromQuery || !focusFieldIdFromQuery) {
      setSearchHighlightedCells([]);
      appliedFocusCellRef.current = null;
      return;
    }
    if (!groups.length) return;

    setSearchHighlightedCells([
      { assetId: focusAssetIdFromQuery, fieldId: focusFieldIdFromQuery },
    ]);

    const focusCellKey = `${focusAssetIdFromQuery}-${focusFieldIdFromQuery}`;
    if (appliedFocusCellRef.current === focusCellKey) return;
    appliedFocusCellRef.current = focusCellKey;
    requestCellScroll(focusAssetIdFromQuery, focusFieldIdFromQuery);
  }, [focusAssetIdFromQuery, focusFieldIdFromQuery, groups, requestCellScroll]);

  const handleTableFindHighlightCells = useCallback(
    (cells: Array<{ assetId: string; fieldId: string }>) => {
      setSearchHighlightedCells(cells);
    },
    []
  );

  const handleTableFindClearHighlight = useCallback(() => {
    clearSearchCellHighlight();
  }, [clearSearchCellHighlight]);

  const handleTableFindFocusSection = useCallback(
    (sectionId: string) => {
      if (!sectionId || !groups.some((group) => group.section.id === sectionId)) return;
      setActiveSectionId(sectionId);
      if (typeof window !== 'undefined') {
        window.sessionStorage.setItem(sectionStateStorageKey, sectionId);
      }
    },
    [groups, sectionStateStorageKey, setActiveSectionId]
  );

  const handleTableFindScrollToCell = useCallback(
    (assetId: string, fieldId: string) => requestCellScroll(assetId, fieldId),
    [requestCellScroll]
  );

  return {
    searchHighlightedCellKeys,
    scrollTargetCell,
    handleTableFindHighlightCells,
    handleTableFindClearHighlight,
    handleTableFindFocusSection,
    handleTableFindScrollToCell,
  };
}
