import { useMemo } from 'react';
import type { PropertyConfig, SectionConfig } from '@/lib/types/libraryAssets';
import {
  buildPropertyGroups,
  detectScriptColumns,
} from '../utils/tableStructure';

export function useLibraryTableStructure(
  sections: SectionConfig[],
  properties: PropertyConfig[]
) {
  const { groups, orderedProperties } = useMemo(
    () => buildPropertyGroups(sections, properties),
    [sections, properties]
  );

  const { scriptColumns, hasScriptColumns } = useMemo(
    () => detectScriptColumns(orderedProperties),
    [orderedProperties]
  );

  return {
    groups,
    orderedProperties,
    scriptColumns,
    hasScriptColumns,
  };
}
