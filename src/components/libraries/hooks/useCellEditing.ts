import { useState, useRef, useCallback } from 'react';
import type { AssetRow, PropertyConfig } from '@/lib/types/libraryAssets';

/**
 * useCellEditing - Handle cell editing logic
 * 
 * Core responsibilities:
 * - Manage editing state (which cell is being edited)
 * - Handle value validation based on data type
 * - Save edited cells with optimistic updates
 * - Handle double-click to start editing
 * - Cancel editing
 */
export function useCellEditing({
  properties,
  rows,
  yRows,
  onUpdateAsset,
  userRole,
  isAddingRow,
  setOptimisticEditUpdates,
  setIsSaving,
  setCurrentFocusedCell,
  presenceTracking,
  handleCellFocus,
}: {
  properties: PropertyConfig[];
  rows: AssetRow[];
  yRows: any; // Yjs array type
  onUpdateAsset?: (assetId: string, assetName: string, propertyValues: Record<string, any>) => Promise<void>;
  userRole: 'admin' | 'editor' | 'viewer' | null;
  isAddingRow: boolean;
  setOptimisticEditUpdates: React.Dispatch<React.SetStateAction<Map<string, { name: string; propertyValues: Record<string, any> }>>>;
  setIsSaving: React.Dispatch<React.SetStateAction<boolean>>;
  setCurrentFocusedCell: React.Dispatch<React.SetStateAction<{ assetId: string; propertyKey: string } | null>>;
  presenceTracking?: {
    updateActiveCell: (assetId: string | null, propertyKey: string | null) => void;
  };
  handleCellFocus: (assetId: string, propertyKey: string) => void;
}) {
  // Edit mode state: track which cell is being edited (rowId and propertyKey)
  const [editingCell, setEditingCell] = useState<{ rowId: string; propertyKey: string } | null>(null);
  const [editingCellValue, setEditingCellValue] = useState<string>('');
  const editingCellRef = useRef<HTMLSpanElement | null>(null);
  const isComposingRef = useRef(false);
  
  // Type validation error state: track validation errors for current editing cell
  const [typeValidationError, setTypeValidationError] = useState<string | null>(null);
  const typeValidationErrorRef = useRef<HTMLDivElement | null>(null);

  // Validate value based on data type
  const validateValueByType = useCallback((value: string, dataType: string): {
    isValid: boolean;
    error: string | null;
    normalizedValue: string | number | null;
  } => {
    // 统一处理空值：数组类型默认为空数组 []，其他类型为 null
    if (value === '' || value === null || value === undefined) {
      if (
        dataType === 'int_array' ||
        dataType === 'float_array' ||
        dataType === 'string_array'
      ) {
        return { isValid: true, error: null, normalizedValue: '[]' };
      }
      return { isValid: true, error: null, normalizedValue: null };
    }

    if (dataType === 'int_array') {
      let trimmed = value.trim();
      // 如果用户没有手动输入 [ ]，则自动补全一对方括号
      if (trimmed !== '' && (!trimmed.startsWith('[') || !trimmed.endsWith(']'))) {
        trimmed = `[${trimmed}]`;
      }
      const inner = trimmed.slice(1, -1);
      // empty array is allowed: [] or [ ]
      if (inner.trim() === '') {
        return { isValid: true, error: null, normalizedValue: '[]' };
      }
      const parts = inner.split(',');
      // any empty item after trimming is illegal
      for (const part of parts) {
        const t = part.trim();
        if (t === '') {
          return {
            isValid: false,
            error: 'The array format is incorrect. Empty elements are not allowed.',
            normalizedValue: null,
          };
        }
        // detect illegal separators like "[1 2 3]" (missing comma)
        if (/\s/.test(t)) {
          return {
            isValid: false,
            error: 'The array format is incorrect. Missing comma separator.',
            normalizedValue: null,
          };
        }
        const num = parseInt(t, 10);
        if (Number.isNaN(num)) {
          return {
            isValid: false,
            error: 'The array format is incorrect. Elements must be integers.',
            normalizedValue: null,
          };
        }
      }
      // normalized string: [1,2,3]
      const normalized = `[${parts.map((p) => parseInt(p.trim(), 10)).join(',')}]`;
      return { isValid: true, error: null, normalizedValue: normalized };
    }

    if (dataType === 'float_array') {
      let trimmed = value.trim();
      // 如果用户没有手动输入 [ ]，则自动补全一对方括号
      if (trimmed !== '' && (!trimmed.startsWith('[') || !trimmed.endsWith(']'))) {
        trimmed = `[${trimmed}]`;
      }
      const inner = trimmed.slice(1, -1);
      if (inner.trim() === '') {
        return { isValid: true, error: null, normalizedValue: '[]' };
      }
      const parts = inner.split(',');
      for (const part of parts) {
        const t = part.trim();
        if (t === '') {
          return {
            isValid: false,
            error: 'The array format is incorrect. Empty elements are not allowed.',
            normalizedValue: null,
          };
        }
        // detect illegal separators like "[1.2 3.4]"
        if (/\s/.test(t)) {
          return {
            isValid: false,
            error: 'The array format is incorrect. Missing comma separator.',
            normalizedValue: null,
          };
        }
        const num = parseFloat(t);
        if (Number.isNaN(num)) {
          return {
            isValid: false,
            error: 'The array format is incorrect. Elements must be floats.',
            normalizedValue: null,
          };
        }
      }
      const normalized = `[${parts.map((p) => parseFloat(p.trim())).join(',')}]`;
      return { isValid: true, error: null, normalizedValue: normalized };
    }

    if (dataType === 'string_array') {
      let trimmed = value.trim();
      // 如果用户没有手动输入 [ ]，则自动补全一对方括号
      if (trimmed !== '' && (!trimmed.startsWith('[') || !trimmed.endsWith(']'))) {
        trimmed = `[${trimmed}]`;
      }
      // Directly parse JSON arrays, supporting complex content such as ["A","B"] and ["s", "d","x"]
      try {
        const parsed = JSON.parse(trimmed);
        if (!Array.isArray(parsed)) {
          return {
            isValid: false,
            error: 'The array format is incorrect. Please use the format ["A","B"].',
            normalizedValue: null,
          };
        }
        if (parsed.length === 0) {
          return { isValid: true, error: null, normalizedValue: '[]' };
        }
        // All elements must be strings
        for (const item of parsed) {
          if (typeof item !== 'string') {
            return {
              isValid: false,
              error: 'The array format is incorrect. Elements must be strings.',
              normalizedValue: null,
            };
          }
        }
        // Normalize to standard JSON string
        const normalized = JSON.stringify(parsed);
        return { isValid: true, error: null, normalizedValue: normalized };
      } catch {
        return {
          isValid: false,
          error: 'Invalid array format. Please use the format ["A","B"].',
          normalizedValue: null,
        };
      }
    }
    
    if (dataType === 'int') {
      // Int type: must be a valid integer (no decimal point)
      const trimmed = value.trim();
      if (trimmed === '' || trimmed === '-') {
        return { isValid: true, error: null, normalizedValue: null };
      }
      
      // Check if contains decimal point
      if (trimmed.includes('.')) {
        return { 
          isValid: false, 
          error: 'type mismatch', 
          normalizedValue: null 
        };
      }
      
      // Check if valid integer
      const intValue = parseInt(trimmed, 10);
      if (isNaN(intValue) || String(intValue) !== trimmed.replace(/^-/, '')) {
        return { 
          isValid: false, 
          error: 'type mismatch', 
          normalizedValue: null 
        };
      }
      
      return { isValid: true, error: null, normalizedValue: intValue };
    } else if (dataType === 'float') {
      // Float type: must contain a decimal point (cannot be pure integer)
      const trimmed = value.trim();
      if (trimmed === '' || trimmed === '-' || trimmed === '.') {
        return { isValid: true, error: null, normalizedValue: null };
      }
      
      // Check if contains decimal point
      if (!trimmed.includes('.')) {
        return { 
          isValid: false, 
          error: 'type mismatch', 
          normalizedValue: null 
        };
      }
      
      // Check if valid float
      const floatValue = parseFloat(trimmed);
      if (isNaN(floatValue)) {
        return { 
          isValid: false, 
          error: 'type mismatch', 
          normalizedValue: null 
        };
      }
      return { isValid: true, error: null, normalizedValue: floatValue };
    }
    
    // Other types: no validation needed
    return { isValid: true, error: null, normalizedValue: value };
  }, []);

  // Handle save edited cell
  const handleSaveEditedCell = useCallback(async () => {
    // Prevent editing if user is a viewer
    if (userRole === 'viewer') {
      return;
    }
    
    if (!editingCell || !onUpdateAsset) return;
    
    const { rowId, propertyKey } = editingCell;
    const row = rows.find(r => r.id === rowId);
    if (!row) return;
    
    // Get the property to determine if it's the name field
    const property = properties.find(p => p.key === propertyKey);
    // Name field is identified by label='name' and dataType='string', not by position
    const isNameField = property && property.name === 'name' && property.dataType === 'string';
    
    // Validate value based on data type (only for non-name fields)
    let normalizedValue: string | number | null = editingCellValue;
    if (!isNameField && property) {
      const validation = validateValueByType(editingCellValue, property.dataType);
      
      if (!validation.isValid) {
        // Show error message and prevent saving
        setTypeValidationError(validation.error);
        // Keep editing state so user can correct the error
        // Focus back on the input
        setTimeout(() => {
          editingCellRef.current?.focus();
        }, 100);
        return;
      }
      
      // Clear validation error if valid，并使用规范化后的值
      setTypeValidationError(null);
      normalizedValue = validation.normalizedValue;
    }
    
    // Update property values with normalized value
    
    const updatedPropertyValues = {
      ...row.propertyValues,
      [propertyKey]: normalizedValue
    };
    
    // Get asset name (use first property value or row name)
    const assetName = isNameField ? editingCellValue : (row.name || 'Untitled');
    
    // Immediately update Yjs (optimistic update)
    const allRows = yRows.toArray();
    const rowIndex = allRows.findIndex(r => r.id === rowId);
    
    if (rowIndex >= 0) {
      const existingRow = allRows[rowIndex];
      const updatedRow = {
        ...existingRow,
        name: String(assetName),
        propertyValues: updatedPropertyValues
      };
      
      // Update Yjs
      yRows.delete(rowIndex, 1);
      yRows.insert(rowIndex, [updatedRow]);
    }

    // Apply optimistic update
    setOptimisticEditUpdates(prev => {
      const newMap = new Map(prev);
      newMap.set(rowId, {
        name: String(assetName),
        propertyValues: updatedPropertyValues
      });
      return newMap;
    });

    // Reset editing state immediately for better UX
    const savedValue = editingCellValue;
    const savedRowId = editingCell.rowId;
    const savedPropertyKey = editingCell.propertyKey;
    setEditingCell(null);
    setEditingCellValue('');
    setTypeValidationError(null); // Clear validation error
    editingCellRef.current = null;
    isComposingRef.current = false;
    setCurrentFocusedCell(null); // Clear focused cell when saving
    
    // Delay clearing presence to give other users time to see the highlight
    // This ensures collaborative editing visibility is maintained
    setTimeout(() => {
      if (presenceTracking) {
        presenceTracking.updateActiveCell(null, null);
      }
    }, 1000); // 1 second delay

    setIsSaving(true);
    try {
      await onUpdateAsset(rowId, assetName, updatedPropertyValues);
      // Remove optimistic update after a short delay to allow parent to refresh
      setTimeout(() => {
        setOptimisticEditUpdates(prev => {
          const newMap = new Map(prev);
          newMap.delete(rowId);
          return newMap;
        });
      }, 500);
    } catch (error) {
      console.error('Failed to update cell:', error);
      // On error, revert optimistic update
      setOptimisticEditUpdates(prev => {
        const newMap = new Map(prev);
        newMap.delete(rowId);
        return newMap;
      });
      // Restore editing state so user can try again
      setEditingCell({ rowId, propertyKey });
      setEditingCellValue(savedValue);
      alert('Failed to update cell. Please try again.');
    } finally {
      setIsSaving(false);
    }
  }, [
    editingCell,
    editingCellValue,
    onUpdateAsset,
    properties,
    rows,
    yRows,
    setOptimisticEditUpdates,
    userRole,
    validateValueByType,
    setTypeValidationError,
    setCurrentFocusedCell,
    presenceTracking,
    setIsSaving,
  ]);

  // Handle double click on cell to start editing (only for editable cell types)
  const handleCellDoubleClick = useCallback((row: AssetRow, property: PropertyConfig, e: React.MouseEvent) => {
    // Prevent editing if user is a viewer (only admin and editor can edit)
    if (userRole === 'viewer') {
      return;
    }
    
    // Prevent editing if adding a new row
    if (isAddingRow) {
      return;
    }
    
    // Don't allow double-click editing for option, reference, boolean, image, and file types
    // These types have their own single-click interaction patterns
    if (property.dataType === 'enum' || 
        (property.dataType === 'reference' && property.referenceLibraries) || 
        property.dataType === 'boolean' ||
        property.dataType === 'image' ||
        property.dataType === 'file') {
      return;
    }
    
    // If already editing this cell, do nothing
    if (editingCell?.rowId === row.id && editingCell?.propertyKey === property.key) {
      return;
    }
    
    // Prevent event bubbling to avoid conflicts
    e.stopPropagation();
    
    // Start editing this cell
    // For name field, fallback to row.name if propertyValues doesn't have it
    // Name field is identified by label='name' and dataType='string', not by position
    const isNameField = property && property.name === 'name' && property.dataType === 'string';
    let currentValue = row.propertyValues[property.key];
    if (isNameField && (currentValue === null || currentValue === undefined || currentValue === '')) {
      // Only use row.name as fallback if it's not 'Untitled' (for blank rows)
      if (row.name && row.name !== 'Untitled') {
        currentValue = row.name;
      }
    }
    let stringValue = currentValue !== null && currentValue !== undefined ? String(currentValue) : '';
    // 对数组类型，如果当前值为空，则自动填充一对方括号，方便用户直接在内部输入
    if (
      (property.dataType === 'int_array' ||
        property.dataType === 'float_array' ||
        property.dataType === 'string_array') &&
      stringValue === ''
    ) {
      stringValue = '[]';
    }
    setEditingCell({ rowId: row.id, propertyKey: property.key });
    setEditingCellValue(stringValue);
    isComposingRef.current = false;
    
    // Update presence tracking when starting to edit
    handleCellFocus(row.id, property.key);
    
    // Initialize the contentEditable element after state update
    setTimeout(() => {
      if (editingCellRef.current) {
        editingCellRef.current.textContent = stringValue;
        editingCellRef.current.focus();
        const range = document.createRange();
        range.selectNodeContents(editingCellRef.current);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
    }, 0);
  }, [userRole, isAddingRow, editingCell, properties, handleCellFocus]);

  // Handle cancel editing
  const handleCancelEditing = useCallback(() => {
    setTypeValidationError(null); // Clear validation error when canceling
    setEditingCell(null);
    setEditingCellValue('');
    editingCellRef.current = null;
    isComposingRef.current = false;
    setCurrentFocusedCell(null); // Clear focused cell when canceling editing
    
    // Also update presence tracking
    if (presenceTracking) {
      presenceTracking.updateActiveCell(null, null);
    }
  }, [setCurrentFocusedCell, presenceTracking]);

  return {
    // State
    editingCell,
    editingCellValue,
    editingCellRef,
    isComposingRef,
    typeValidationError,
    typeValidationErrorRef,
    
    // Setters
    setEditingCell,
    setEditingCellValue,
    setTypeValidationError,
    
    // Handlers
    handleSaveEditedCell,
    handleCellDoubleClick,
    handleCancelEditing,
    validateValueByType,
  };
}
