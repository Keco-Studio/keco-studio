import { useCallback, useRef } from 'react';
import type { AssetRow, PropertyConfig } from '@/lib/types/libraryAssets';
import type { useTableDataManager } from './useTableDataManager';
import { applyPasteToRows } from './batchOperations';

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
  onUpdateAssets,
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
  setOptimisticEditUpdates,
  setIsSaving,
  setToastMessage,
  setBatchEditMenuVisible,
  setBatchEditMenuPosition,
  clipboardData,
  isCutOperation,
  cutCells,
  copyCells,
  cutSelectionBounds,
  copySelectionBounds,
}: {
  dataManager: DataManager;
  orderedProperties: PropertyConfig[];
  getAllRowsForCellSelection: () => AssetRow[];
  selectedCells: Set<CellKey>;
  selectedRowIds: Set<string>;
  onSaveAsset?: (assetName: string, propertyValues: Record<string, any>, options?: { createdAt?: Date }) => Promise<void>;
  onUpdateAsset?: (assetId: string, assetName: string, propertyValues: Record<string, any>) => Promise<void>;
  onUpdateAssets?: (updates: Array<{ assetId: string; assetName: string; propertyValues: Record<string, any> }>) => Promise<void>;
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
  setOptimisticEditUpdates: React.Dispatch<React.SetStateAction<Map<string, { name: string; propertyValues: Record<string, any> }>>>;
  setIsSaving: React.Dispatch<React.SetStateAction<boolean>>;
  setToastMessage: React.Dispatch<React.SetStateAction<{ message: string; type: 'success' | 'error' | 'default' } | null>>;
  setBatchEditMenuVisible: React.Dispatch<React.SetStateAction<boolean>>;
  setBatchEditMenuPosition: React.Dispatch<React.SetStateAction<{ x: number; y: number } | null>>;
  clipboardData: Array<Array<string | number | null>> | null;
  isCutOperation: boolean;
  cutCells: Set<CellKey>;
  copyCells: Set<CellKey>;
  cutSelectionBounds: {
    minRowIndex: number;
    maxRowIndex: number;
    minPropertyIndex: number;
    maxPropertyIndex: number;
    rowIds: string[];
    propertyKeys: string[];
  } | null;
  copySelectionBounds: {
    minRowIndex: number;
    maxRowIndex: number;
    minPropertyIndex: number;
    maxPropertyIndex: number;
    rowIds: string[];
    propertyKeys: string[];
  } | null;
}) {
  const isPastingRef = useRef(false);

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
      
      // Copy/Cut 一律用「当前最新行」（含乐观更新），保证复制的就是表格当前显示的值
      const rowToRead = (dataManager.getRowValue(rowId) as AssetRow | null) ?? row;
      
      // Check if this is the name field (identified by label='name' and dataType='string')
      const isNameField = foundProperty && foundProperty.name === 'name' && foundProperty.dataType === 'string';
      
      let value: string | number | null;
      if (isNameField) {
        const raw = rowToRead.propertyValues?.[propertyKey];
        const hasRaw = raw !== null && raw !== undefined && raw !== '';
        const displayStr = hasRaw ? String(raw) : ((rowToRead.name && rowToRead.name !== 'Untitled') ? rowToRead.name : null);
        value = displayStr;
      } else {
        value = getCellValue(rowToRead, propertyKey, foundProperty, false);
      }
      
      if (!cellsByRow.has(rowId)) {
        cellsByRow.set(rowId, []);
      }
      cellsByRow.get(rowId)!.push({ propertyKey, rowId, value });
      validCells.push(cellKey);
    });

    if (validCells.length === 0) {
      // Still show feedback even if no valid cells
      setToastMessage({ message: 'No cells with supported types (string, int, float) selected', type: 'default' });
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
              const property = orderedProperties[propertyIndex];
              // Name field is identified by label='name' and dataType='string', not by position
              const isNameField = property && property.name === 'name' && property.dataType === 'string';
              
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
          // 与 delete row 一致：多行走批量接口，减少往返与竞态
          const cutUpdates = toUpdate.map(({ rowId, assetName, propertyValues }) => ({ assetId: rowId, assetName, propertyValues }));
          if (cutUpdates.length > 1 && onUpdateAssets) {
            await onUpdateAssets(cutUpdates);
          } else {
            await Promise.all(cutUpdates.map((u) => onUpdateAsset!(u.assetId, u.assetName, u.propertyValues)));
          }
        } catch (error) {
          console.error('Failed to clear cut cells:', error);
        }
      })();
    }
    
    // Show toast message immediately
    setToastMessage({ message: 'Content cut', type: 'success' });
    
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
    onUpdateAssets,
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
      
      // Copy/Cut 一律用「当前最新行」（含乐观更新），保证复制的就是表格当前显示的值
      const rowToRead = (dataManager.getRowValue(rowId) as AssetRow | null) ?? row;
      
      // Check if this is the name field (identified by label='name' and dataType='string')
      const isNameField = foundProperty && foundProperty.name === 'name' && foundProperty.dataType === 'string';
      
      let value: string | number | null;
      if (isNameField) {
        const raw = rowToRead.propertyValues?.[propertyKey];
        const hasRaw = raw !== null && raw !== undefined && raw !== '';
        const displayStr = hasRaw ? String(raw) : ((rowToRead.name && rowToRead.name !== 'Untitled') ? rowToRead.name : null);
        value = displayStr;
      } else {
        value = getCellValue(rowToRead, propertyKey, foundProperty, false);
      }
      
      if (!cellsByRow.has(rowId)) {
        cellsByRow.set(rowId, []);
      }
      cellsByRow.get(rowId)!.push({ propertyKey, rowId, value });
      validCells.push(cellKey);
    });

    if (validCells.length === 0) {
      setToastMessage({ message: 'No cells with supported types (string, int, float) selected', type: 'default' });
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
    setToastMessage({ message: 'Content copied', type: 'success' });
    
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
      setToastMessage({ message: 'No content to paste. Please copy or cut cells first.', type: 'default' });
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
      setToastMessage({ message: 'Please select cells to paste', type: 'default' });
      setTimeout(() => setToastMessage(null), 2000);
      return;
    }

    // 防重入：避免快捷键/菜单重复触发导致「一次 paste 执行两遍」出现多扩行、重复内容
    if (isPastingRef.current) return;
    isPastingRef.current = true;

    try {
    // 使用与表格一致的「视图行」计算锚点和扩行，避免 merge 后 yRows 与视图不同步导致 paste 空白/不扩行
    const viewRows = getAllRowsForCellSelection();
    let bestRowIndex = Number.POSITIVE_INFINITY;
    let bestPropertyIndex = Number.POSITIVE_INFINITY;
    cellsToUse.forEach((cellKey) => {
      const { rowId, propertyKey, property } = parseCellKey(cellKey);
      if (!rowId || !propertyKey || !property) return;
      const rowIndex = viewRows.findIndex((r: AssetRow) => r.id === rowId);
      if (rowIndex < 0) return;
      const propertyIndex = orderedProperties.findIndex((p) => p.key === propertyKey);
      if (propertyIndex < 0) return;
      if (rowIndex < bestRowIndex || (rowIndex === bestRowIndex && propertyIndex < bestPropertyIndex)) {
        bestRowIndex = rowIndex;
        bestPropertyIndex = propertyIndex;
      }
    });
    if (bestRowIndex === Number.POSITIVE_INFINITY || bestPropertyIndex === Number.POSITIVE_INFINITY) {
      setToastMessage({ message: '请先选择要粘贴到的单元格', type: 'default' });
      setTimeout(() => setToastMessage(null), 2000);
      return;
    }
    const startRowIndex = bestRowIndex;
    const startPropertyIndex = bestPropertyIndex;

    const sourcePropertyKeys = (isCutOperation ? cutSelectionBounds : copySelectionBounds)?.propertyKeys ?? [];
    const result = applyPasteToRows(
      viewRows,
      orderedProperties,
      { rowIndex: startRowIndex, colIndex: startPropertyIndex },
      clipboardData,
      sourcePropertyKeys.length > 0 ? sourcePropertyKeys : undefined
    );

    if (result.typeMismatch) {
      setBatchEditMenuVisible(false);
      setBatchEditMenuPosition(null);
      setToastMessage({ message: 'type mismatch', type: 'error' });
      setTimeout(() => setToastMessage(null), 2000);
      return;
    }

    setBatchEditMenuVisible(false);
    setBatchEditMenuPosition(null);
    setToastMessage({ message: 'Content pasted', type: 'success' });
    setTimeout(() => setToastMessage(null), 2000);

    if (result.updates.length > 0 && onUpdateAsset) {
      setIsSaving(true);
      try {
        // 视图行索引与 Yjs 可能不一致（乐观行、sync 顺序），用 row.id 查 Yjs 索引再写回
        const ySnapshot = yRows.toArray();
        const idToYIndex = new Map<string, number>();
        ySnapshot.forEach((r: AssetRow, idx: number) => idToYIndex.set(r.id, idx));

        const rowsToUpdate: Array<{ index: number; row: AssetRow }> = [];
        result.updates.forEach(({ row }) => {
          const yIndex = idToYIndex.get(row.id);
          if (yIndex !== undefined) rowsToUpdate.push({ index: yIndex, row });
        });
        rowsToUpdate.sort((a, b) => a.index - b.index);
        rowsToUpdate.forEach(({ index, row }) => {
          yRows.delete(index, 1);
          yRows.insert(index, [row]);
        });

        // 粘贴到现有行后设置乐观编辑，避免 useYjsSync 用 props（如清空后的数据）覆盖 yRows 导致粘贴内容被抹掉
        setOptimisticEditUpdates((prev) => {
          const next = new Map(prev);
          rowsToUpdate.forEach(({ row }) => {
            next.set(row.id, { name: row.name ?? '', propertyValues: row.propertyValues ?? {} });
          });
          return next;
        });

        // 与 delete row 一致：多行走批量接口
        const pasteUpdates = rowsToUpdate
          .filter(({ row }) => !row.id.startsWith('temp-'))
          .map(({ row }) => ({ assetId: row.id, assetName: row.name ?? '', propertyValues: row.propertyValues }));
        if (pasteUpdates.length > 1 && onUpdateAssets) {
          await onUpdateAssets(pasteUpdates);
        } else if (pasteUpdates.length > 0) {
          await Promise.all(pasteUpdates.map((u) => onUpdateAsset!(u.assetId, u.assetName, u.propertyValues)));
        }
      } catch (error) {
        console.error('Failed to update rows for paste:', error);
        setIsSaving(false);
        setBatchEditMenuVisible(false);
        setBatchEditMenuPosition(null);
        setToastMessage({ message: 'Failed to paste: could not update cells', type: 'error' });
        setTimeout(() => setToastMessage(null), 2000);
        return;
      } finally {
        setIsSaving(false);
      }
    }

    if (result.creates.length > 0 && onSaveAsset && library) {
      setIsSaving(true);
      try {
        const now = Date.now();
        const optimisticAssets: AssetRow[] = [];
        const savePromises: Array<Promise<void>> = [];
        for (let i = 0; i < result.creates.length; i++) {
          const rowData = result.creates[i];
          const assetName = rowData.name || '';
          const tempId = `temp-paste-${now}-${i}-${Math.random().toString(36).substr(2, 9)}`;
          optimisticAssets.push({
            id: tempId,
            libraryId: library.id,
            name: assetName,
            propertyValues: { ...rowData.propertyValues },
          });
          savePromises.push(onSaveAsset(assetName, rowData.propertyValues));
        }
        yRows.insert(yRows.length, optimisticAssets);
        setOptimisticNewAssets((prev) => {
          const next = new Map(prev);
          optimisticAssets.forEach((a) => next.set(a.id, a));
          return next;
        });
        await Promise.all(savePromises);
      } catch (error) {
        console.error('Failed to create rows for paste:', error);
        setIsSaving(false);
        setBatchEditMenuVisible(false);
        setBatchEditMenuPosition(null);
        setToastMessage({ message: 'Failed to paste: could not create new rows', type: 'error' });
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
    } finally {
      isPastingRef.current = false;
    }
  }, [
    selectedCells,
    selectedRowIds,
    getAllRowsForCellSelection,
    orderedProperties,
    onSaveAsset,
    onUpdateAsset,
    onUpdateAssets,
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
    setOptimisticEditUpdates,
    setIsSaving,
    setToastMessage,
    setBatchEditMenuVisible,
    setBatchEditMenuPosition,
    clipboardData,
    isCutOperation,
    cutCells,
    copyCells,
    cutSelectionBounds,
    copySelectionBounds,
  ]);

  return {
    handleCut,
    handleCopy,
    handlePaste,
  };
}
