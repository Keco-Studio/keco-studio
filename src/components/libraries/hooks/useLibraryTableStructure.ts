import { useMemo } from 'react';
import type { PropertyConfig } from '@/lib/types/libraryAssets';
import { detectScriptColumns, orderProperties } from '../utils/tableStructure';

export function useLibraryTableStructure(
  properties: PropertyConfig[]
) {
  const orderedProperties = useMemo(() => orderProperties(properties), [properties]);

  const { scriptColumns, hasScriptColumns } = useMemo(
    () => detectScriptColumns(orderedProperties),
    [orderedProperties]
  );

  return {
    orderedProperties,
    scriptColumns,
    hasScriptColumns,
  };
}
