import { useCallback, useMemo } from 'react';
import type { PropertyConfig } from '@/lib/types/libraryAssets';
import type { CellKey } from './useCellSelection';

const MEDIA_DATA_TYPES = new Set(['image', 'file', 'multimedia', 'audio']);

export function useMediaClearContentsMenu({
  orderedProperties,
  selectedCells,
  onClearContents,
  closeMenu,
  openConfirmation,
}: {
  orderedProperties: PropertyConfig[];
  selectedCells: Set<CellKey>;
  onClearContents: () => Promise<void>;
  closeMenu: () => void;
  openConfirmation: () => void;
}) {
  const selectedMediaCellsOnly = useMemo(
    () => selectedCells.size > 0 && [...selectedCells].every((cellKey) =>
      orderedProperties.some((property) =>
        cellKey.endsWith(`-${property.key}`) && MEDIA_DATA_TYPES.has(property.dataType ?? '')
      )
    ),
    [orderedProperties, selectedCells],
  );

  const handleClearContents = useCallback(() => {
    closeMenu();
    if (selectedMediaCellsOnly) void onClearContents();
    else openConfirmation();
  }, [closeMenu, onClearContents, openConfirmation, selectedMediaCellsOnly]);

  return {
    clearContentsLabel: selectedMediaCellsOnly ? 'Delete media' : undefined,
    handleClearContents,
  };
}
