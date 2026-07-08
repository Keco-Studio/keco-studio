import { useCallback, useEffect, useRef, useState } from 'react';
import type { AssetRow, PropertyConfig } from '@/lib/types/libraryAssets';
import type { PropertyGroup } from '../utils/tableStructure';

type UseLibraryTableFindReplaceWiringArgs = {
  libraryId?: string;
  groups: PropertyGroup[];
  activeSectionId: string | null;
  sectionStateStorageKey: string;
  focusSectionIdFromQuery: string | null;
  focusAssetIdFromQuery: string | null;
  focusFieldIdFromQuery: string | null;
  activeProperties: PropertyConfig[];
  resolvedRows: AssetRow[];
  setActiveSectionId: React.Dispatch<React.SetStateAction<string | null>>;
  searchCellHitClassName: string;
};

export function useLibraryTableFindReplaceWiring({
  libraryId,
  groups,
  activeSectionId,
  sectionStateStorageKey,
  focusSectionIdFromQuery,
  focusAssetIdFromQuery,
  focusFieldIdFromQuery,
  activeProperties,
  resolvedRows,
  setActiveSectionId,
  searchCellHitClassName,
}: UseLibraryTableFindReplaceWiringArgs) {
  const [searchHighlightedCells, setSearchHighlightedCells] = useState<
    Array<{ assetId: string; fieldId: string }>
  >([]);
  const appliedFocusSectionRef = useRef<string | null>(null);
  const appliedFocusCellRef = useRef<string | null>(null);

  const clearSearchCellHighlight = useCallback(() => {
    setSearchHighlightedCells([]);
    appliedFocusCellRef.current = null;
    if (typeof document === 'undefined') return;
    document
      .querySelectorAll(`.${searchCellHitClassName}`)
      .forEach((el) => el.classList.remove(searchCellHitClassName));
  }, [searchCellHitClassName]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const current = Array.from(document.querySelectorAll(`.${searchCellHitClassName}`));
    current.forEach((el) => el.classList.remove(searchCellHitClassName));
    if (searchHighlightedCells.length === 0) return;
    searchHighlightedCells.forEach(({ assetId, fieldId }) => {
      const el = document.querySelector(
        `tr[data-row-id="${assetId}"] td[data-property-key="${fieldId}"]`
      ) as HTMLElement | null;
      el?.classList.add(searchCellHitClassName);
    });
  }, [searchHighlightedCells, activeProperties, resolvedRows, searchCellHitClassName]);

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

    setTimeout(() => {
      const el = document.querySelector(
        `tr[data-row-id="${focusAssetIdFromQuery}"] td[data-property-key="${focusFieldIdFromQuery}"]`
      ) as HTMLElement | null;
      el?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
    }, 0);
  }, [focusAssetIdFromQuery, focusFieldIdFromQuery, groups]);

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

  const handleTableFindScrollToCell = useCallback((assetId: string, fieldId: string) => {
    setTimeout(() => {
      const el = document.querySelector(
        `tr[data-row-id="${assetId}"] td[data-property-key="${fieldId}"]`
      ) as HTMLElement | null;
      el?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
    }, 0);
  }, []);

  return {
    handleTableFindHighlightCells,
    handleTableFindClearHighlight,
    handleTableFindFocusSection,
    handleTableFindScrollToCell,
  };
}
