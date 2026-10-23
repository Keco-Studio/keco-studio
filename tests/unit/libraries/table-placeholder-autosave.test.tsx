/** @jest-environment jsdom */

import { act, renderHook, waitFor } from '@testing-library/react';
import { useClickOutsideAutoSave } from '@/components/libraries/hooks/useClickOutsideAutoSave';

describe('viewport placeholder row autosave', () => {
  it('discards an untouched placeholder editor without persisting a blank row', async () => {
    const onSaveAsset = jest.fn(async () => undefined);
    const setIsAddingRow = jest.fn();
    const tableContainer = document.createElement('div');
    const addRow = document.createElement('tr');

    renderHook(() => useClickOutsideAutoSave({
      tableContainerRef: { current: tableContainer },
      addRowFormRef: { current: addRow },
      isAddingRow: true,
      newRowData: {},
      setIsAddingRow,
      setNewRowData: jest.fn(),
      isSaving: false,
      setIsSaving: jest.fn(),
      referenceModalOpen: false,
      onSaveAsset,
      library: { id: 'library-1', name: 'Characters' },
      properties: [],
      setOptimisticNewAssets: jest.fn(),
      editingCell: null,
      editingCellInitialValueRef: { current: '' },
      setEditingCell: jest.fn(),
      setCurrentFocusedCell: jest.fn(),
      rows: [],
      rowStore: { toArray: () => [], delete: jest.fn(), insert: jest.fn() },
      setOptimisticEditUpdates: jest.fn(),
      discardBlankAddRow: true,
    }));

    act(() => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });

    await waitFor(() => expect(setIsAddingRow).toHaveBeenCalledWith(false));
    expect(onSaveAsset).not.toHaveBeenCalled();
  });
});
