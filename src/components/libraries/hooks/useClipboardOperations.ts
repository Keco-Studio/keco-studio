import { useCallback } from 'react';
import type { AssetRow, PropertyConfig } from '@/lib/types/libraryAssets';
import type { useTableDataManager } from './useTableDataManager';

type CellKey = `${string}-${string}`; // Format: "rowId-propertyKey"

type DataManager = ReturnType<typeof useTableDataManager>;

/**
 * useClipboardOperations - Handle clipboard operations (Cut, Copy, Paste)
 * 
 * Core responsibilities:
 * - Extract clipboard operation logic from main component
 * - Handle Cut/Copy/Paste operations
 * - Manage clipboard state and visual feedback
 * - Support Excel-like clipboard behavior
 */
export function useClipboardOperations({
  dataManager,
  orderedProperties,
  getAllRowsForCellSelection,
  selectedCells,
  selectedRowIds,
  onSaveAsset,
  onUpdateAsset,
  library,
  yRows,
  setSelectedCells,
  setSelectedRowIds,
  setCutCells,
  setCopyCells,
  setClipboardData,
  setIsCutOperation,
  setCutSelectionBounds,
  setCopySelectionBounds,
  setOptimisticNewAssets,
  setIsSaving,
  setToastMessage,
  setBatchEditMenuVisible,
  setBatchEditMenuPosition,
  clipboardData,
  isCutOperation,
  cutCells,
  copyCells,
}: {
  dataManager: DataManager;
  orderedProperties: PropertyConfig[];
  getAllRowsForCellSelection: () => AssetRow[];
  selectedCells: Set<CellKey>;
  selectedRowIds: Set<string>;
  onSaveAsset?: (assetName: string, propertyValues: Record<string, any>, options?: { createdAt?: Date }) => Promise<void>;
  onUpdateAsset?: (assetId: string, assetName: string, propertyValues: Record<string, any>) => Promise<void>;
  library: { id: string; name: string; description?: string | null } | null;
  yRows: any; // Yjs array type
  setSelectedCells: React.Dispatch<React.SetStateAction<Set<CellKey>>>;
  setSelectedRowIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  setCutCells: React.Dispatch<React.SetStateAction<Set<CellKey>>>;
  setCopyCells: React.Dispatch<React.SetStateAction<Set<CellKey>>>;
  setClipboardData: React.Dispatch<React.SetStateAction<Array<Array<string | number | null>> | null>>;
  setIsCutOperation: React.Dispatch<React.SetStateAction<boolean>>;
  setCutSelectionBounds: React.Dispatch<React.SetStateAction<{
    minRowIndex: number;
    maxRowIndex: number;
    minPropertyIndex: number;
    maxPropertyIndex: number;
    rowIds: string[];
    propertyKeys: string[];
  } | null>>;
  setCopySelectionBounds: React.Dispatch<React.SetStateAction<{
    minRowIndex: number;
    maxRowIndex: number;
    minPropertyIndex: number;
    maxPropertyIndex: number;
    rowIds: string[];
    propertyKeys: string[];
  } | null>>;
  setOptimisticNewAssets: React.Dispatch<React.SetStateAction<Map<string, AssetRow>>>;
  setIsSaving: React.Dispatch<React.SetStateAction<boolean>>;
  setToastMessage: React.Dispatch<React.SetStateAction<string | null>>;
  setBatchEditMenuVisible: React.Dispatch<React.SetStateAction<boolean>>;
  setBatchEditMenuPosition: React.Dispatch<React.SetStateAction<{ x: number; y: number } | null>>;
  clipboardData: Array<Array<string | number | null>> | null;
  isCutOperation: boolean;
  cutCells: Set<CellKey>;
  copyCells: Set<CellKey>;
}) {
  /**
   * Parse cellKey to extract rowId and propertyKey
   * Handles UUIDs that may contain multiple dashes
   */
  const parseCellKey = useCallback((cellKey: string): { rowId: string; propertyKey: string; property: PropertyConfig | null } => {
    let rowId = '';
    let propertyKey = '';
    let foundProperty = null;
    
    // Try each property.key to find a match (starting from the end)
    for (const property of orderedProperties) {
      const propertyKeyWithDash = '-' + property.key;
      if (cellKey.endsWith(propertyKeyWithDash)) {
        // Found a match: cellKey ends with "-{property.key}"
        rowId = cellKey.substring(0, cellKey.length - propertyKeyWithDash.length);
        propertyKey = property.key;
        foundProperty = property;
        break;
      }
    }
    
    return { rowId, propertyKey, property: foundProperty };
  }, [orderedProperties]);

  /**
   * Get cell value with proper type conversion
   */
  const getCellValue = useCallback((
    row: AssetRow,
    propertyKey: string,
    property: PropertyConfig,
    isNameField: boolean
  ): string | number | null => {
    let rawValue = row.propertyValues[propertyKey];
    
    // For name field, if propertyValues doesn't have it, use row.name as fallback
    if (isNameField && (rawValue === null || rawValue === undefined || rawValue === '')) {
      if (row.name && row.name !== 'Untitled') {
        rawValue = row.name;
      }
    }
    
    let value: string | number | null = null;
    
    // Convert to appropriate type based on property data type.
    // For int/float: preserve number as-is to avoid losing decimals (e.g. 12.5).
    // Truncation to int happens only when pasting into an int column.
    if (rawValue !== null && rawValue !== undefined && rawValue !== '') {
      if (property.dataType === 'int') {
        if (typeof rawValue === 'number' && !isNaN(rawValue)) {
          value = rawValue;
        } else {
          const numValue = parseFloat(String(rawValue));
          value = isNaN(numValue) ? null : numValue;
        }
      } else if (property.dataType === 'float') {
        if (typeof rawValue === 'number' && !isNaN(rawValue)) {
          value = rawValue;
        } else {
          const numValue = parseFloat(String(rawValue));
          value = isNaN(numValue) ? null : numValue;
        }
      } else if (property.dataType === 'string') {
        value = String(rawValue);
      }
    }
    
    return value;
  }, []);

  /**
   * Convert selected rows to cell selection
   */
  const convertRowsToCells = useCallback((rowIds: Set<string>): Set<CellKey> => {
    const allRowCellKeys: CellKey[] = [];
    rowIds.forEach(selectedRowId => {
      orderedProperties.forEach(property => {
        allRowCellKeys.push(`${selectedRowId}-${property.key}` as CellKey);
      });
    });
    return new Set(allRowCellKeys);
  }, [orderedProperties]);

  /**
   * Handle Cut operation
   */
  const handleCut = useCallback(() => {
    // If rows are selected but cells are not, convert rows to cells
    let cellsToCut = selectedCells;
    if (selectedCells.size === 0 && selectedRowIds.size > 0) {
      const convertedCells = convertRowsToCells(selectedRowIds);
      cellsToCut = convertedCells;
      setSelectedCells(convertedCells);
    }
    
    if (cellsToCut.size === 0) {
      setBatchEditMenuVisible(false);
      setBatchEditMenuPosition(null);
      return;
    }

    const allRowsForSelection = getAllRowsForCellSelection();
    
    // Group selected cells by row to build a 2D array
    const cellsByRow = new Map<string, Array<{ propertyKey: string; rowId: string; value: string | number | null }>>();
    const validCells: CellKey[] = [];

    // Check each selected cell and validate data type
    cellsToCut.forEach((cellKey) => {
      const { rowId, propertyKey, property: foundProperty } = parseCellKey(cellKey);
      
      if (!foundProperty) {
        return;
      }
      
      // Check if data type is supported (string, int, float)
      if (!foundProperty.dataType) {
        return;
      }
      
      const supportedTypes = ['string', 'int', 'float'];
      if (!supportedTypes.includes(foundProperty.dataType)) {
        return; // Skip unsupported types
      }
      
      // Find the row
      const row = allRowsForSelection.find(r => r.id === rowId);
      if (!row) {
        return;
      }
      
      // Get the property index to check if this is the name field
      const propertyIndex = orderedProperties.findIndex(p => p.key === propertyKey);
      const isNameField = propertyIndex === 0;
      
      // 对齐 batch fill：从 base 取源值，保留原始类型（如 float 12.5），避免 getRowsWithOptimisticUpdates 合并导致的小数丢失
      const baseRow = dataManager.getRowBaseValue(rowId);
      let value: string | number | null;
      if (baseRow) {
        const raw = isNameField
          ? (baseRow.name ?? baseRow.propertyValues?.[propertyKey] ?? null)
          : (baseRow.propertyValues?.[propertyKey] ?? null);
        value = (raw === '' || raw === undefined) ? null : (raw as string | number | null);
        // Name 字段：base 为 null 时回退到 row.name，避免 paste 出现 "Untitled"（base 滞后于乐观更新）
        if (isNameField && value === null && row.name && row.name !== 'Untitled') {
          value = row.name;
        }
      } else {
        value = getCellValue(row, propertyKey, foundProperty, isNameField);
      }
      
      if (!cellsByRow.has(rowId)) {
        cellsByRow.set(rowId, []);
      }
      cellsByRow.get(rowId)!.push({ propertyKey, rowId, value });
      validCells.push(cellKey);
    });

    if (validCells.length === 0) {
      // Still show feedback even if no valid cells
      setToastMessage('No cells with supported types (string, int, float) selected');
      setTimeout(() => {
        setToastMessage(null);
      }, 2000);
      setBatchEditMenuVisible(false);
      setBatchEditMenuPosition(null);
      return;
    }

    // Build 2D array (rows x columns) for clipboard
    // Find the range of rows and columns
    const rowIds = Array.from(cellsByRow.keys());
    const propertyKeys = new Set<string>();
    validCells.forEach(cellKey => {
      const { propertyKey } = parseCellKey(cellKey);
      if (propertyKey) {
        propertyKeys.add(propertyKey);
      }
    });
    
    // Sort rows by their index in allRowsForSelection
    rowIds.sort((a, b) => {
      const indexA = allRowsForSelection.findIndex(r => r.id === a);
      const indexB = allRowsForSelection.findIndex(r => r.id === b);
      return indexA - indexB;
    });
    
    // Sort properties by their index in orderedProperties
    const sortedPropertyKeys = Array.from(propertyKeys).sort((a, b) => {
      const indexA = orderedProperties.findIndex(p => p.key === a);
      const indexB = orderedProperties.findIndex(p => p.key === b);
      return indexA - indexB;
    });
    
    // Calculate selection bounds for border rendering (only show outer border)
    const rowIndices = rowIds.map(rowId => {
      return allRowsForSelection.findIndex(r => r.id === rowId);
    }).filter(idx => idx !== -1);
    
    const propertyIndices = sortedPropertyKeys.map(propKey => {
      return orderedProperties.findIndex(p => p.key === propKey);
    }).filter(idx => idx !== -1);
    
    const minRowIndex = Math.min(...rowIndices);
    const maxRowIndex = Math.max(...rowIndices);
    const minPropertyIndex = Math.min(...propertyIndices);
    const maxPropertyIndex = Math.max(...propertyIndices);
    
    // Build 2D array
    const clipboardArray: Array<Array<string | number | null>> = [];
    rowIds.forEach(rowId => {
      const row = allRowsForSelection.find(r => r.id === rowId);
      if (!row) return;
      
      const rowData: Array<string | number | null> = [];
      sortedPropertyKeys.forEach(propertyKey => {
        const cell = cellsByRow.get(rowId)?.find(c => c.propertyKey === propertyKey);
        rowData.push(cell?.value ?? null);
      });
      clipboardArray.push(rowData);
    });
    
    // Copy to clipboard (as tab-separated values for Excel-like behavior)
    const clipboardText = clipboardArray
      .map(row => row.map(cell => cell === null ? '' : String(cell)).join('\t'))
      .join('\n');
    
    // Try to copy to system clipboard
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(clipboardText).catch(err => {
        console.error('Failed to copy to clipboard:', err);
      });
    }
    
    // Store clipboard data and mark as cut operation
    setClipboardData(clipboardArray);
    setIsCutOperation(true);
    
    // Mark cells as cut (for dashed border visual feedback)
    setCutCells(new Set(validCells));
    
    // Store selection bounds for border rendering (only show outer border)
    if (rowIndices.length > 0 && propertyIndices.length > 0) {
      setCutSelectionBounds({
        minRowIndex,
        maxRowIndex,
        minPropertyIndex,
        maxPropertyIndex,
        rowIds,
        propertyKeys: sortedPropertyKeys,
      });
    }
    
    // Immediately clear cell contents after cut (don't wait for paste)
    if (onUpdateAsset) {
      // Group cut cells by rowId
      const cutCellsByRow = new Map<string, { propertyValues: Record<string, any>; assetName: string | null }>();
      
      validCells.forEach((cellKey) => {
        const { rowId, propertyKey } = parseCellKey(cellKey);
        const propertyIndex = orderedProperties.findIndex(p => p.key === propertyKey);
        
        if (rowId && propertyKey) {
          const row = allRowsForSelection.find(r => r.id === rowId);
          if (row) {
            if (!cutCellsByRow.has(rowId)) {
              // Copy all existing property values (may include boolean and other types)
              cutCellsByRow.set(rowId, { 
                propertyValues: { ...row.propertyValues }, 
                assetName: row.name || null 
              });
            }
            const rowUpdates = cutCellsByRow.get(rowId);
            if (rowUpdates) {
              // Check if this is the name field (first property)
              const isNameField = propertyIndex === 0;
              
              if (isNameField) {
                // Clear the name field by setting both assetName and propertyValues
                rowUpdates.assetName = '';
                rowUpdates.propertyValues[propertyKey] = null;
              } else {
                // Clear the property value
                rowUpdates.propertyValues[propertyKey] = null;
              }
            }
          }
        }
      });
      
      // 先改 Yjs（同步、瞬间生效），再并行持久化到 DB，不占用 setIsSaving，避免与紧接着的 Paste 冲突导致卡顿
      (async () => {
        try {
          const allRows = yRows.toArray();
          const toUpdate: Array<{ rowId: string; rowIndex: number; assetName: string; propertyValues: Record<string, any>; updatedRow: AssetRow }> = [];
          for (const [rowId, rowData] of cutCellsByRow.entries()) {
            const row = allRows.find(r => r.id === rowId);
            if (!row) continue;
            const assetName = rowData.assetName !== null ? rowData.assetName : (row.name || 'Untitled');
            const rowIndex = allRows.findIndex(r => r.id === rowId);
            if (rowIndex < 0) continue;
            const updatedRow = { ...row, name: assetName, propertyValues: rowData.propertyValues };
            toUpdate.push({ rowId, rowIndex, assetName, propertyValues: rowData.propertyValues, updatedRow });
          }
          // Yjs 按索引从大到小更新，避免 delete+insert 导致下标错位
          toUpdate.sort((a, b) => b.rowIndex - a.rowIndex);
          toUpdate.forEach(({ rowIndex, updatedRow }) => {
            yRows.delete(rowIndex, 1);
            yRows.insert(rowIndex, [updatedRow]);
          });
          // 并行写 DB，缩短 Cut 完成时间，减少与 Paste 重叠造成的排队
          await Promise.all(toUpdate.map(({ rowId, assetName, propertyValues }) => onUpdateAsset(rowId, assetName, propertyValues)));
        } catch (error) {
          console.error('Failed to clear cut cells:', error);
        }
      })();
    }
    
    // Show toast message immediately
    setToastMessage('Content cut');
    
    // Close menu first
    setBatchEditMenuVisible(false);
    setBatchEditMenuPosition(null);
    
    // Clear row selection and cell selection after cut operation
    // This allows user to select other rows for paste
    setSelectedRowIds(new Set());
    setSelectedCells(new Set());
    // Note: cutCells and cutSelectionBounds are still set to show the dashed border
    
    // Auto-hide toast after 2 seconds
    setTimeout(() => {
      setToastMessage(null);
    }, 2000);
  }, [
    dataManager,
    selectedCells,
    selectedRowIds,
    getAllRowsForCellSelection,
    orderedProperties,
    onUpdateAsset,
    yRows,
    parseCellKey,
    getCellValue,
    convertRowsToCells,
    setSelectedCells,
    setSelectedRowIds,
    setCutCells,
    setClipboardData,
    setIsCutOperation,
    setCutSelectionBounds,
    setToastMessage,
    setBatchEditMenuVisible,
    setBatchEditMenuPosition,
  ]);

  /**
   * Handle Copy operation
   * Similar to Cut but doesn't clear cells
   */
  const handleCopy = useCallback(() => {
    // If rows are selected but cells are not, convert rows to cells
    let cellsToCopy = selectedCells;
    if (selectedCells.size === 0 && selectedRowIds.size > 0) {
      const convertedCells = convertRowsToCells(selectedRowIds);
      cellsToCopy = convertedCells;
      setSelectedCells(convertedCells);
    }
    
    if (cellsToCopy.size === 0) {
      setBatchEditMenuVisible(false);
      setBatchEditMenuPosition(null);
      return;
    }

    const allRowsForSelection = getAllRowsForCellSelection();
    
    // Group selected cells by row to build a 2D array
    const cellsByRow = new Map<string, Array<{ propertyKey: string; rowId: string; value: string | number | null }>>();
    const validCells: CellKey[] = [];

    // Check each selected cell and validate data type
    cellsToCopy.forEach((cellKey) => {
      const { rowId, propertyKey, property: foundProperty } = parseCellKey(cellKey);
      
      if (!foundProperty) {
        return;
      }
      
      // Check if data type is supported (string, int, float)
      if (!foundProperty.dataType) {
        return;
      }
      
      const supportedTypes = ['string', 'int', 'float'];
      if (!supportedTypes.includes(foundProperty.dataType)) {
        return; // Skip unsupported types
      }
      
      // Find the row
      const row = allRowsForSelection.find(r => r.id === rowId);
      if (!row) {
        return;
      }
      
      // Get the property index to check if this is the name field
      const propertyIndex = orderedProperties.findIndex(p => p.key === propertyKey);
      const isNameField = propertyIndex === 0;
      
      // 对齐 batch fill：从 base 取源值，保留原始类型（如 float 12.5），避免 getRowsWithOptimisticUpdates 合并导致的小数丢失
      const baseRow = dataManager.getRowBaseValue(rowId);
      let value: string | number | null;
      if (baseRow) {
        const raw = isNameField
          ? (baseRow.name ?? baseRow.propertyValues?.[propertyKey] ?? null)
          : (baseRow.propertyValues?.[propertyKey] ?? null);
        value = (raw === '' || raw === undefined) ? null : (raw as string | number | null);
        // Name 字段：base 为 null 时回退到 row.name，避免 paste 出现 "Untitled"（base 滞后于乐观更新）
        if (isNameField && value === null && row.name && row.name !== 'Untitled') {
          value = row.name;
        }
      } else {
        value = getCellValue(row, propertyKey, foundProperty, isNameField);
      }
      
      if (!cellsByRow.has(rowId)) {
        cellsByRow.set(rowId, []);
      }
      cellsByRow.get(rowId)!.push({ propertyKey, rowId, value });
      validCells.push(cellKey);
    });

    if (validCells.length === 0) {
      setToastMessage('No cells with supported types (string, int, float) selected');
      setTimeout(() => {
        setToastMessage(null);
      }, 2000);
      setBatchEditMenuVisible(false);
      setBatchEditMenuPosition(null);
      return;
    }

    // Build 2D array (rows x columns) for clipboard
    const rowIds = Array.from(cellsByRow.keys());
    const propertyKeys = new Set<string>();
    validCells.forEach(cellKey => {
      const { propertyKey } = parseCellKey(cellKey);
      if (propertyKey) {
        propertyKeys.add(propertyKey);
      }
    });
    
    // Sort rows and properties
    rowIds.sort((a, b) => {
      const indexA = allRowsForSelection.findIndex(r => r.id === a);
      const indexB = allRowsForSelection.findIndex(r => r.id === b);
      return indexA - indexB;
    });
    
    const sortedPropertyKeys = Array.from(propertyKeys).sort((a, b) => {
      const indexA = orderedProperties.findIndex(p => p.key === a);
      const indexB = orderedProperties.findIndex(p => p.key === b);
      return indexA - indexB;
    });
    
    // Calculate selection bounds
    const rowIndices = rowIds.map(rowId => {
      return allRowsForSelection.findIndex(r => r.id === rowId);
    }).filter(idx => idx !== -1);
    
    const propertyIndices = sortedPropertyKeys.map(propKey => {
      return orderedProperties.findIndex(p => p.key === propKey);
    }).filter(idx => idx !== -1);
    
    const minRowIndex = Math.min(...rowIndices);
    const maxRowIndex = Math.max(...rowIndices);
    const minPropertyIndex = Math.min(...propertyIndices);
    const maxPropertyIndex = Math.max(...propertyIndices);
    
    // Build 2D array
    const clipboardArray: Array<Array<string | number | null>> = [];
    rowIds.forEach(rowId => {
      const row = allRowsForSelection.find(r => r.id === rowId);
      if (!row) return;
      
      const rowData: Array<string | number | null> = [];
      sortedPropertyKeys.forEach(propertyKey => {
        const cell = cellsByRow.get(rowId)?.find(c => c.propertyKey === propertyKey);
        rowData.push(cell?.value ?? null);
      });
      clipboardArray.push(rowData);
    });
    
    // Copy to clipboard
    const clipboardText = clipboardArray
      .map(row => row.map(cell => cell === null ? '' : String(cell)).join('\t'))
      .join('\n');
    
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(clipboardText).catch(err => {
        console.error('Failed to copy to clipboard:', err);
      });
    }
    
    // Store clipboard data and mark as copy operation
    setClipboardData(clipboardArray);
    setIsCutOperation(false);
    
    // Mark cells as copied (for dashed border visual feedback)
    setCopyCells(new Set(validCells));
    
    // Store selection bounds for border rendering
    if (rowIndices.length > 0 && propertyIndices.length > 0) {
      setCopySelectionBounds({
        minRowIndex,
        maxRowIndex,
        minPropertyIndex,
        maxPropertyIndex,
        rowIds,
        propertyKeys: sortedPropertyKeys,
      });
    }
    
    // Show toast message
    setToastMessage('Content copied');
    
    // Close menu
    setBatchEditMenuVisible(false);
    setBatchEditMenuPosition(null);
    
    // Auto-hide toast after 2 seconds
    setTimeout(() => {
      setToastMessage(null);
    }, 2000);
  }, [
    dataManager,
    selectedCells,
    selectedRowIds,
    getAllRowsForCellSelection,
    orderedProperties,
    parseCellKey,
    getCellValue,
    convertRowsToCells,
    setSelectedCells,
    setCopyCells,
    setClipboardData,
    setIsCutOperation,
    setCopySelectionBounds,
    setToastMessage,
    setBatchEditMenuVisible,
    setBatchEditMenuPosition,
  ]);

  /**
   * Handle Paste operation
   * This is a complex operation that handles both updating existing rows and creating new rows
   */
  const handlePaste = useCallback(async () => {
    // Check if there is clipboard data (from props)
    if (!clipboardData || clipboardData.length === 0 || clipboardData[0].length === 0) {
      setBatchEditMenuVisible(false);
      setBatchEditMenuPosition(null);
      setToastMessage('No content to paste. Please copy or cut cells first.');
      setTimeout(() => setToastMessage(null), 2000);
      return;
    }
    
    // Check if there are selected cells or selected rows
    // If rows are selected, convert them to cell selection
    let cellsToUse = selectedCells;
    if (selectedCells.size === 0 && selectedRowIds.size > 0) {
      // Convert selected rows to cell selection
      const convertedCells = convertRowsToCells(selectedRowIds);
      cellsToUse = convertedCells;
      setSelectedCells(convertedCells);
    }
    
    // Check again if there are selected cells after conversion
    if (cellsToUse.size === 0) {
      setBatchEditMenuVisible(false);
      setBatchEditMenuPosition(null);
      setToastMessage('Please select cells to paste');
      setTimeout(() => setToastMessage(null), 2000);
      return;
    }
    
    const allRowsForSelection = getAllRowsForCellSelection();
    
    // Find the first selected cell as the paste starting point
    const firstSelectedCell = Array.from(cellsToUse)[0] as CellKey;
    if (!firstSelectedCell) {
      return;
    }
    
    // Parse the first selected cell to get rowId and propertyKey
    const { rowId: startRowId, propertyKey: startPropertyKey, property: foundStartProperty } = parseCellKey(firstSelectedCell);
    
    if (!foundStartProperty || !startRowId) {
      return;
    }
    
    // Find the starting row index and property index
    const startRowIndex = allRowsForSelection.findIndex(r => r.id === startRowId);
    const startPropertyIndex = orderedProperties.findIndex(p => p.key === startPropertyKey);
    
    if (startRowIndex === -1 || startPropertyIndex === -1) {
      return;
    }
    
    // Store updates to apply
    const updatesToApply: Array<{ rowId: string; propertyKey: string; value: string | number | null }> = [];
    // Map to store new rows data by target row index (relative to current rows)
    const rowsToCreateByIndex = new Map<number, { name: string; propertyValues: Record<string, any> }>();
    
    // Calculate how many new rows we need to create
    const maxTargetRowIndex = startRowIndex + clipboardData.length - 1;
    const rowsNeeded = Math.max(0, maxTargetRowIndex - allRowsForSelection.length + 1);
    
    // Initialize new rows
    for (let i = 0; i < rowsNeeded; i++) {
      const targetRowIndex = allRowsForSelection.length + i;
      rowsToCreateByIndex.set(targetRowIndex, { name: 'Untitled', propertyValues: {} });
    }
    
    // Iterate through clipboard data and map to target cells
    clipboardData.forEach((clipboardRow, clipboardRowIndex) => {
      clipboardRow.forEach((cellValue, clipboardColIndex) => {
        const targetRowIndex = startRowIndex + clipboardRowIndex;
        const targetPropertyIndex = startPropertyIndex + clipboardColIndex;
        
        // Check if target property exists
        if (targetPropertyIndex >= orderedProperties.length) {
          return; // Skip if column is out of range
        }
        
        const targetProperty = orderedProperties[targetPropertyIndex];
        
        // Check if data type is supported (string, int, float)
        if (!targetProperty.dataType || !['string', 'int', 'float'].includes(targetProperty.dataType)) {
          return; // Skip unsupported types
        }
        
        // Convert value to appropriate type (string, int, float)
        let convertedValue: string | number | null = null;
        if (cellValue !== null && cellValue !== undefined && cellValue !== '') {
          if (targetProperty.dataType === 'int') {
            const numValue = parseInt(String(cellValue), 10);
            convertedValue = isNaN(numValue) ? null : numValue;
          } else if (targetProperty.dataType === 'float') {
            // Preserve number as-is to avoid losing decimals (e.g. 12.3 from cut/copy)
            if (typeof cellValue === 'number' && !isNaN(cellValue)) {
              convertedValue = cellValue;
            } else {
              const numValue = parseFloat(String(cellValue));
              convertedValue = isNaN(numValue) ? null : numValue;
            }
          } else if (targetProperty.dataType === 'string') {
            convertedValue = String(cellValue);
          }
        }
        
        // Check if target row exists, add to create map or update list
        if (targetRowIndex >= allRowsForSelection.length) {
          // Need to create new row - add value to the row data
          const newRowData = rowsToCreateByIndex.get(targetRowIndex);
          if (newRowData) {
            // For name field (propertyIndex === 0), set it as the name field, not in propertyValues
            if (targetPropertyIndex === 0) {
              newRowData.name = convertedValue !== null ? String(convertedValue) : 'Untitled';
            } else {
              newRowData.propertyValues[targetProperty.key] = convertedValue;
            }
          }
        } else {
          // Target row exists, prepare update
          const targetRow = allRowsForSelection[targetRowIndex];
          
          updatesToApply.push({
            rowId: targetRow.id,
            propertyKey: targetProperty.key,
            value: convertedValue,
          });
        }
      });
    });
    
    const rowsToCreate = Array.from(rowsToCreateByIndex.values());
    
    // Close menu and show toast immediately so UI feels responsive (async work continues in background)
    setBatchEditMenuVisible(false);
    setBatchEditMenuPosition(null);
    setToastMessage('Content pasted');
    setTimeout(() => setToastMessage(null), 2000);
    
    // Create new rows if needed (create them first before updating existing rows)
    if (rowsToCreate.length > 0 && onSaveAsset && library) {
      setIsSaving(true);
      try {
        // Create rows sequentially with optimistic updates
        const createdTempIds: string[] = [];
        for (let i = 0; i < rowsToCreate.length; i++) {
          const rowData = rowsToCreate[i];
          const assetName = rowData.name || '';
          
          // Create optimistic asset row with temporary ID
          const tempId = `temp-paste-${Date.now()}-${i}-${Math.random().toString(36).substr(2, 9)}`;
          createdTempIds.push(tempId);
          
          const optimisticAsset: AssetRow = {
            id: tempId,
            libraryId: library.id,
            name: assetName,
            propertyValues: { ...rowData.propertyValues },
          };

          // Optimistically add the asset to Yjs immediately (resolve row ordering issues)
          yRows.insert(yRows.length, [optimisticAsset]);
          
          // Also add to optimisticNewAssets for compatibility
          setOptimisticNewAssets(prev => {
            const newMap = new Map(prev);
            newMap.set(tempId, optimisticAsset);
            return newMap;
          });
          
          await onSaveAsset(assetName, rowData.propertyValues);
        }
        // Wait a bit for parent to refresh and match optimistic assets with real ones
        await new Promise(resolve => setTimeout(resolve, 500));
        // Clean up optimistic assets after parent refresh (they should be replaced by real assets)
        setTimeout(() => {
          createdTempIds.forEach(tempId => {
            setOptimisticNewAssets(prev => {
              if (prev.has(tempId)) {
                const newMap = new Map(prev);
                newMap.delete(tempId);
                return newMap;
              }
              return prev;
            });
          });
        }, 2000);
      } catch (error) {
        console.error('Failed to create rows for paste:', error);
        setIsSaving(false);
        setBatchEditMenuVisible(false);
        setBatchEditMenuPosition(null);
        setToastMessage('Failed to paste: could not create new rows');
        setTimeout(() => setToastMessage(null), 2000);
        return;
      } finally {
        setIsSaving(false);
      }
    }
    
    // Apply updates to existing rows
    if (updatesToApply.length > 0 && onUpdateAsset) {
      setIsSaving(true);
      try {
        // Group updates by rowId for efficiency
        // Track both propertyValues and name field updates separately
        const updatesByRow = new Map<string, { propertyValues: Record<string, any>; name?: string | null }>();
        const nameFieldKey = orderedProperties[0]?.key;
        
        // 对齐 batch fill：从 base 构建 propertyValues 再合并粘贴值，避免合并逻辑导致 float 小数丢失
        updatesToApply.forEach(({ rowId, propertyKey, value }) => {
          if (!updatesByRow.has(rowId)) {
            const baseRow = dataManager.getRowBaseValue(rowId);
            const row = allRowsForSelection.find(r => r.id === rowId);
            if (baseRow) {
              updatesByRow.set(rowId, { 
                propertyValues: { ...baseRow.propertyValues },
                name: baseRow.name
              });
            } else if (row) {
              updatesByRow.set(rowId, { 
                propertyValues: { ...row.propertyValues },
                name: row.name
              });
            } else {
              updatesByRow.set(rowId, { propertyValues: {} });
            }
          }
          // Update with new value
          const rowUpdates = updatesByRow.get(rowId);
          if (rowUpdates) {
            // Check if this is the name field (first property)
            if (propertyKey === nameFieldKey) {
              // Update name field separately
              rowUpdates.name = value !== null ? String(value) : 'Untitled';
              // Also update propertyValues for consistency
              rowUpdates.propertyValues[propertyKey] = value;
            } else {
              // Update property value
              rowUpdates.propertyValues[propertyKey] = value;
            }
          }
        });
        
        // Apply updates - update Yjs first, then update database
        // Get snapshot of current Yjs array (before update)
        const allRows = yRows.toArray();
        const rowIndexMap = new Map<string, number>();
        allRows.forEach((r, idx) => rowIndexMap.set(r.id, idx));
        
        // Batch update Yjs first (reverse order update to avoid index changes)
        const rowsToUpdate: Array<{ rowId: string; index: number; row: AssetRow }> = [];
        for (const [rowId, rowData] of updatesByRow.entries()) {
          const row = allRowsForSelection.find(r => r.id === rowId);
          if (row) {
            const rowIndex = rowIndexMap.get(rowId);
            if (rowIndex !== undefined) {
              // Use updated name if name field was pasted, otherwise use existing row.name
              const updatedName = rowData.name !== undefined ? rowData.name : (row.name || 'Untitled');
              rowsToUpdate.push({
                rowId,
                index: rowIndex,
                row: {
                  ...row,
                  name: updatedName,
                  propertyValues: rowData.propertyValues
                }
              });
            }
          }
        }
        
        // Update Yjs in reverse order (from back to front, avoid index change impact)
        rowsToUpdate.sort((a, b) => b.index - a.index);
        rowsToUpdate.forEach(({ index, row }) => {
          yRows.delete(index, 1);
          yRows.insert(index, [row]);
        });
        
        // Update database with correct name value
        const updatePromises = Array.from(updatesByRow.entries())
          .map(([rowId, rowData]) => {
            const row = allRowsForSelection.find(r => r.id === rowId);
            if (!row) return Promise.resolve();
            // Use updated name if name field was pasted, otherwise use existing row.name
            const updatedName = rowData.name !== undefined ? rowData.name : (row.name || 'Untitled');
            return onUpdateAsset(rowId, updatedName, rowData.propertyValues);
          });
        await Promise.all(updatePromises);
      } catch (error) {
        console.error('Failed to update rows for paste:', error);
        setIsSaving(false);
        setBatchEditMenuVisible(false);
        setBatchEditMenuPosition(null);
        setToastMessage('Failed to paste: could not update cells');
        setTimeout(() => setToastMessage(null), 2000);
        return;
      } finally {
        setIsSaving(false);
      }
    }
    
    // If this was a cut operation, clear the cut state (cells were already cleared during cut)
    // Use values from props
    if (isCutOperation && cutCells.size > 0) {
      // Clear cut state to remove visual feedback (dashed border)
      // Note: cell contents were already cleared during cut operation
      setCutCells(new Set());
      setCutSelectionBounds(null);
      setIsCutOperation(false);
      setClipboardData(null);
    } else {
      // If not a cut operation, clear copy state to remove visual feedback (dashed border)
      // Use values from props
      if (copyCells.size > 0) {
        setCopyCells(new Set());
        setCopySelectionBounds(null);
      }
      // Clear clipboard data
      setClipboardData(null);
      setIsCutOperation(false);
    }
    
    // Clear selected cells and rows after paste operation
    setSelectedCells(new Set());
    setSelectedRowIds(new Set());
  }, [
    dataManager,
    selectedCells,
    selectedRowIds,
    getAllRowsForCellSelection,
    orderedProperties,
    onSaveAsset,
    onUpdateAsset,
    library,
    yRows,
    parseCellKey,
    convertRowsToCells,
    setSelectedCells,
    setSelectedRowIds,
    setCutCells,
    setCopyCells,
    setClipboardData,
    setIsCutOperation,
    setCutSelectionBounds,
    setCopySelectionBounds,
    setOptimisticNewAssets,
    setIsSaving,
    setToastMessage,
    setBatchEditMenuVisible,
    setBatchEditMenuPosition,
    clipboardData,
    isCutOperation,
    cutCells,
    copyCells,
  ]);

  return {
    handleCut,
    handleCopy,
    handlePaste,
  };
}
