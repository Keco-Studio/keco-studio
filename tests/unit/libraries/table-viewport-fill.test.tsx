/** @jest-environment jsdom */

import React, { type ComponentProps } from 'react';
import { DndContext } from '@dnd-kit/core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LibraryAssetsTableBody } from '@/components/libraries/components/LibraryAssetsTableBody';

jest.mock('@/lib/SupabaseContext', () => ({
  useSupabase: () => ({}),
}));

type BodyProps = ComponentProps<typeof LibraryAssetsTableBody>;

function makeProps(overrides: Partial<BodyProps> = {}): BodyProps {
  return {
    displayRows: [],
    rows: [],
    tableIndexes: {
      rowIndexById: new Map(),
      propertyIndexByKey: new Map(),
      rowById: new Map(),
      propertyByKey: new Map(),
    },
    properties: [],
    activeProperties: [],
    orderedProperties: [],
    userRole: 'editor',
    isAddingRow: false,
    isSaving: false,
    newRowData: {},
    openEnumSelects: {},
    assetNamesCache: {},
    avatarRefs: { current: {} },
    addRowFormRef: { current: null },
    hoveredRowId: null,
    selectedRowIds: new Set(),
    selectedCells: new Set(),
    cutCells: new Set(),
    copyCells: new Set(),
    hoveredCellForExpand: null,
    expandedTextCell: null,
    cutSelectionBounds: null,
    copySelectionBounds: null,
    fillDragStartCell: null,
    fillPreviewMap: new Map(),
    searchHighlightedCellKeys: new Set(),
    scrollTargetCell: null,
    referencedAssetId: null,
    referencedNavigationReady: true,
    editingCell: null,
    editingCellRef: { current: null },
    editingCellInitialValueRef: { current: null },
    isComposingRef: { current: false },
    typeValidationError: null,
    typeValidationErrorRef: { current: null },
    setHoveredRowId: jest.fn(),
    setHoveredCellForExpand: jest.fn(),
    setTypeValidationError: jest.fn(),
    setOpenEnumSelects: jest.fn(),
    setToastMessage: jest.fn(),
    hasCustomRowHeight: () => false,
    getRowHeightStyle: () => undefined,
    startRowResize: jest.fn(),
    isResizingRow: false,
    getUsersEditingCell: () => [],
    getSelectionBorderClasses: () => '',
    getCutBorderClasses: () => '',
    getCopyBorderClasses: () => '',
    optimisticUpdates: {} as BodyProps['optimisticUpdates'],
    onUpdateAsset: jest.fn(),
    broadcastCellUpdateIfEnabled: jest.fn(),
    onRowContextMenu: jest.fn(),
    onRowSelectionToggle: jest.fn(),
    onViewAssetDetail: jest.fn(),
    onCellFocus: jest.fn(),
    onCellBlur: jest.fn(),
    onCellClick: jest.fn(),
    onTextCellExpandClick: jest.fn(),
    onCellContextMenu: jest.fn(),
    onCellFillDragStart: jest.fn(),
    onCellDragStart: jest.fn(),
    onCellDoubleClick: jest.fn(),
    onEditMediaFileChange: jest.fn(),
    onOpenReferenceModal: jest.fn(),
    onAvatarMouseEnter: jest.fn(),
    onAvatarMouseLeave: jest.fn(),
    openFormulaEditor: jest.fn(),
    handleInputChange: jest.fn(),
    handleMediaFileChange: jest.fn(),
    handleSaveEditedCell: jest.fn(),
    handleCancelEditing: jest.fn(),
    handleStartAddingRow: jest.fn(),
    handleAddRowDirect: jest.fn(),
    ...overrides,
  };
}

describe('library table viewport fill', () => {
  it('fills the available viewport with non-persisted rows and activates the next row on click', async () => {
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    const originalInnerHeight = window.innerHeight;
    const handleAddRowDirect = jest.fn();
    const handleStartAddingRow = jest.fn();
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 });
    HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
      if (this.tagName === 'TABLE') {
        const fillerCount = this.querySelectorAll('[data-viewport-filler-row]').length;
        return DOMRect.fromRect({ top: 0, bottom: 400 + fillerCount * 40, height: 400 + fillerCount * 40 });
      }
      if (this.hasAttribute('data-viewport-filler-row')) {
        return DOMRect.fromRect({ height: 40 });
      }
      if (this.hasAttribute('data-table-add-row')) {
        return DOMRect.fromRect({ height: 40 });
      }
      return DOMRect.fromRect();
    };

    try {
      render(
        <DndContext>
          <table>
            <LibraryAssetsTableBody
              {...makeProps({ handleAddRowDirect, handleStartAddingRow })}
            />
          </table>
        </DndContext>,
      );

      await waitFor(() => {
        expect(screen.getAllByTestId('viewport-filler-row')).toHaveLength(13);
      });
      expect(document.querySelectorAll('tr[data-row-id]')).toHaveLength(0);

      fireEvent.click(screen.getAllByTestId('viewport-filler-row')[0]);
      expect(handleStartAddingRow).toHaveBeenCalledTimes(1);
      expect(handleAddRowDirect).not.toHaveBeenCalled();

      Object.defineProperty(window, 'innerHeight', { configurable: true, value: 700 });
      fireEvent(window, new Event('resize'));
      await waitFor(() => {
        expect(screen.getAllByTestId('viewport-filler-row')).toHaveLength(8);
      });
    } finally {
      HTMLElement.prototype.getBoundingClientRect = originalRect;
      Object.defineProperty(window, 'innerHeight', {
        configurable: true,
        value: originalInnerHeight,
      });
    }
  });
});
