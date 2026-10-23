/** @jest-environment jsdom */

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from '@jest/globals';
import {
  hasSameCellSelection,
  useCellSelection,
  type CellKey,
} from '@/components/libraries/hooks/useCellSelection';
import { buildTableIndexes } from '@/components/libraries/utils/tableIndexes';
import type { AssetRow, PropertyConfig } from '@/lib/types/libraryAssets';

const rows: AssetRow[] = [{
  id: 'row-1',
  libraryId: 'library-1',
  name: 'Row 1',
  propertyValues: {},
}];
const properties: PropertyConfig[] = [{
  id: 'property-title',
  key: 'title',
  name: 'Title',
  valueType: 'string',
  dataType: 'string',
  orderIndex: 0,
}];

describe('hasSameCellSelection', () => {
  it('treats separately allocated sets with the same cell keys as unchanged', () => {
    const current = new Set<CellKey>(['row-1-title', 'row-2-title']);
    const next = new Set<CellKey>(['row-2-title', 'row-1-title']);

    expect(hasSameCellSelection(current, next)).toBe(true);
  });

  it('detects a changed cell key', () => {
    const current = new Set<CellKey>(['row-1-title']);
    const next = new Set<CellKey>(['row-2-title']);

    expect(hasSameCellSelection(current, next)).toBe(false);
  });

  it('settles after drag starts while table indexes are recreated on render', () => {
    const { result } = renderHook(() => useCellSelection({
      orderedProperties: properties,
      getAllRowsForCellSelection: () => rows,
      tableIndexes: buildTableIndexes(rows, properties),
      fillDown: async () => undefined,
      fillDownIntSequence: async () => undefined,
      currentFocusedCell: null,
      handleCellBlur: () => undefined,
      selectionBorderClassNames: {
        selectionBorderTop: 'top',
        selectionBorderBottom: 'bottom',
        selectionBorderLeft: 'left',
        selectionBorderRight: 'right',
      },
    }));
    const cell = document.createElement('td');

    act(() => {
      result.current.handleCellFillDragStart('row-1', 'title', {
        button: 0,
        target: cell,
        currentTarget: cell,
        preventDefault: () => undefined,
        stopPropagation: () => undefined,
      } as unknown as React.MouseEvent);
    });

    expect(result.current.selectedCells).toEqual(new Set<CellKey>(['row-1-title']));

    act(() => document.dispatchEvent(new MouseEvent('mouseup')));
  });
});
