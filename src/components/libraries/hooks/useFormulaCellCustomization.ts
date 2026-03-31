import { useCallback, useEffect, useState } from 'react';
import type { AssetRow, PropertyConfig } from '@/lib/types/libraryAssets';
import { isFormulaExpressionValid } from '@/lib/utils/formula';

type CellRef = { assetId: string; propertyKey: string } | null;

type UseFormulaCellCustomizationParams = {
  rows: AssetRow[];
  properties: PropertyConfig[];
  onUpdateAsset?: (assetId: string, assetName: string, propertyValues: Record<string, any>) => Promise<void>;
  yRows: any;
  setOptimisticEditUpdates: React.Dispatch<React.SetStateAction<Map<string, { name: string; propertyValues: Record<string, any> }>>>;
  setIsSaving: React.Dispatch<React.SetStateAction<boolean>>;
  message: { error: (msg: string) => void };
  editingCell: { rowId: string; propertyKey: string } | null;
  currentFocusedCell: CellRef;
  selectedCellsSize: number;
  getCustomFormulaExpressionFromCellValue: (rawValue: unknown) => string | null;
  formulaPanelClassName: string;
};

export function useFormulaCellCustomization({
  rows,
  properties,
  onUpdateAsset,
  yRows,
  setOptimisticEditUpdates,
  setIsSaving,
  message,
  editingCell,
  currentFocusedCell,
  selectedCellsSize,
  getCustomFormulaExpressionFromCellValue,
  formulaPanelClassName,
}: UseFormulaCellCustomizationParams) {
  const [formulaModalOpen, setFormulaModalOpen] = useState(false);
  const [formulaModalRowId, setFormulaModalRowId] = useState<string | null>(null);
  const [formulaModalPropertyKey, setFormulaModalPropertyKey] = useState<string | null>(null);
  const [formulaInputValue, setFormulaInputValue] = useState('');
  const [formulaPanelPosition, setFormulaPanelPosition] = useState<{ top: number; left: number } | null>(null);
  const [formulaValidationError, setFormulaValidationError] = useState<string | null>(null);

  const closeFormulaEditor = useCallback(() => {
    setFormulaModalOpen(false);
    setFormulaPanelPosition(null);
    setFormulaValidationError(null);
  }, []);

  const openFormulaEditor = useCallback((rowId: string, propertyKey: string) => {
    const row = rows.find((r) => r.id === rowId);
    const property = properties.find((p) => p.key === propertyKey);
    if (!row || !property || property.dataType !== 'formula') return;

    const existingCustom = getCustomFormulaExpressionFromCellValue(row.propertyValues[propertyKey]);
    const fallback = property.formulaExpression?.trim() ?? '';
    const initial = existingCustom ? existingCustom.replace(/^=/, '') : fallback.replace(/^=/, '');
    setFormulaModalRowId(rowId);
    setFormulaModalPropertyKey(propertyKey);
    setFormulaInputValue(initial);
    setFormulaValidationError(null);

    const panelWidth = 388;
    const panelHeight = 255;
    if (typeof document !== 'undefined') {
      const cell = document.querySelector(
        `tr[data-row-id="${rowId}"] td[data-property-key="${propertyKey}"]`
      ) as HTMLElement | null;
      if (cell) {
        const rect = cell.getBoundingClientRect();
        const margin = 8;
        const maxLeft = Math.max(8, window.innerWidth - panelWidth - 8);
        const left = Math.min(Math.max(8, rect.left), maxLeft);
        const preferredTop = rect.bottom + margin;
        const top =
          preferredTop + panelHeight > window.innerHeight - 8
            ? Math.max(8, rect.top - panelHeight - margin)
            : preferredTop;
        setFormulaPanelPosition({ top, left });
      } else {
        setFormulaPanelPosition({
          top: Math.max(8, window.innerHeight / 2 - panelHeight / 2),
          left: Math.max(8, window.innerWidth / 2 - panelWidth / 2),
        });
      }
    }
    setFormulaModalOpen(true);
  }, [rows, properties, getCustomFormulaExpressionFromCellValue]);

  const handleSaveCustomFormula = useCallback(async () => {
    if (!onUpdateAsset || !formulaModalRowId || !formulaModalPropertyKey) return;
    const row = rows.find((r) => r.id === formulaModalRowId);
    if (!row) return;

    const trimmed = formulaInputValue.trim();
    if (trimmed && !isFormulaExpressionValid(trimmed)) {
      setFormulaValidationError('Invalid formula syntax.');
      return;
    }
    setFormulaValidationError(null);
    const normalizedFormula = trimmed ? (trimmed.startsWith('=') ? trimmed : `=${trimmed}`) : null;
    const updatedPropertyValues = {
      ...row.propertyValues,
      [formulaModalPropertyKey]: normalizedFormula,
    };

    const allRows = yRows.toArray();
    const rowIndex = allRows.findIndex((r: any) => r.id === formulaModalRowId);
    if (rowIndex >= 0) {
      const existingRow = allRows[rowIndex];
      const updatedRow = {
        ...existingRow,
        propertyValues: updatedPropertyValues,
      };
      yRows.delete(rowIndex, 1);
      yRows.insert(rowIndex, [updatedRow]);
    }

    setOptimisticEditUpdates((prev) => {
      const newMap = new Map(prev);
      newMap.set(formulaModalRowId, {
        name: row.name || 'Untitled',
        propertyValues: updatedPropertyValues,
      });
      return newMap;
    });

    setIsSaving(true);
    try {
      await onUpdateAsset(formulaModalRowId, row.name || 'Untitled', updatedPropertyValues);
      closeFormulaEditor();
      setTimeout(() => {
        setOptimisticEditUpdates((prev) => {
          const newMap = new Map(prev);
          newMap.delete(formulaModalRowId);
          return newMap;
        });
      }, 500);
    } catch (err) {
      console.error('Failed to save custom formula:', err);
      setOptimisticEditUpdates((prev) => {
        const newMap = new Map(prev);
        newMap.delete(formulaModalRowId);
        return newMap;
      });
      message.error('Failed to save formula.');
    } finally {
      setIsSaving(false);
    }
  }, [onUpdateAsset, formulaModalRowId, formulaModalPropertyKey, rows, formulaInputValue, yRows, setOptimisticEditUpdates, setIsSaving, closeFormulaEditor, message]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '=' || formulaModalOpen || editingCell) return;
      const target = event.target as HTMLElement | null;
      if (
        !target ||
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable ||
        !!target.closest('.ant-modal') ||
        !!target.closest('[contenteditable="true"]')
      ) {
        return;
      }
      if (!currentFocusedCell || selectedCellsSize !== 1) return;
      const property = properties.find((p) => p.key === currentFocusedCell.propertyKey);
      if (!property || property.dataType !== 'formula') return;
      event.preventDefault();
      event.stopPropagation();
      openFormulaEditor(currentFocusedCell.assetId, currentFocusedCell.propertyKey);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [formulaModalOpen, editingCell, currentFocusedCell, selectedCellsSize, properties, openFormulaEditor]);

  useEffect(() => {
    if (!formulaModalOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest(`.${formulaPanelClassName}`)) return;
      closeFormulaEditor();
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [formulaModalOpen, formulaPanelClassName, closeFormulaEditor]);

  return {
    formulaModalOpen,
    formulaInputValue,
    formulaValidationError,
    formulaPanelPosition,
    setFormulaInputValue: (value: string) => {
      setFormulaInputValue(value);
      if (formulaValidationError) {
        setFormulaValidationError(null);
      }
    },
    openFormulaEditor,
    closeFormulaEditor,
    handleSaveCustomFormula,
  };
}

