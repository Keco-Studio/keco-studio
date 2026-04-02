import { useCallback, useMemo, useState } from 'react';
import type { PropertyConfig, AssetRow } from '@/lib/types/libraryAssets';
import type { CellKey } from './useCellSelection';
import type { SupabaseClient } from '@supabase/supabase-js';
import { shiftRowIndices } from '@/lib/services/libraryAssetsService';

type UpdateAssetFn = (assetId: string, assetName: string, propertyValues: Record<string, any>) => Promise<void>;
type UpdateAssetsFn = (updates: Array<{ assetId: string; assetName: string; propertyValues: Record<string, any> }>) => Promise<void>;
type SaveAssetFn = (
  assetName: string,
  propertyValues: Record<string, any>,
  options?: { createdAt?: Date; rowIndex?: number; skipReload?: boolean },
) => Promise<void>;
type YRowsLike = {
  length: number;
  toArray: () => AssetRow[];
  insert: (index: number, content: AssetRow[]) => void;
  delete: (index: number, length: number) => void;
};

type SelectionContext = {
  property: PropertyConfig;
  values: number[];
  startTargetIndex: number;
} | null;

export function useAiPredictNext(params: {
  selectedCells: Set<CellKey>;
  orderedProperties: PropertyConfig[];
  resolvedRows: AssetRow[];
  rows: AssetRow[];
  library: { id: string; name: string; description?: string | null } | null;
  supabase: SupabaseClient | null;
  onUpdateAsset?: UpdateAssetFn;
  onUpdateAssets?: UpdateAssetsFn;
  onSaveAsset?: SaveAssetFn;
  setIsSaving: React.Dispatch<React.SetStateAction<boolean>>;
  yRows?: YRowsLike;
  setOptimisticNewAssets?: React.Dispatch<React.SetStateAction<Map<string, AssetRow>>>;
  setOptimisticInsertIndices?: React.Dispatch<React.SetStateAction<Map<string, number>>>;
}) {
  const {
    selectedCells,
    orderedProperties,
    resolvedRows,
    rows,
    library,
    supabase,
    onUpdateAsset,
    onUpdateAssets,
    onSaveAsset,
    setIsSaving,
    yRows,
    setOptimisticNewAssets,
    setOptimisticInsertIndices,
  } = params;

  const [open, setOpen] = useState(false);
  const [patternName, setPatternName] = useState('');
  const [propertyKey, setPropertyKey] = useState<string | null>(null);
  const [startRowIndex, setStartRowIndex] = useState<number | null>(null);
  const [count, setCount] = useState(10);
  const [values, setValues] = useState<number[]>([]);
  const [precision, setPrecision] = useState(0);

  const getPredictedValues = useCallback((seedValues: number[], targetCount: number) => {
    if (seedValues.length < 3) return { pattern: '', values: [] as number[] };

    const EPSILON = 1e-9;
    const diffs = seedValues.slice(1).map((v, i) => v - seedValues[i]);
    const isArithmetic = diffs.every((d) => Math.abs(d - diffs[0]) < EPSILON);
    if (isArithmetic) {
      const step = diffs[0];
      const start = seedValues[seedValues.length - 1];
      return {
        pattern: 'Arithmetic',
        values: Array.from({ length: targetCount }, (_, i) => start + step * (i + 1)),
      };
    }

    const nonZeroBase = seedValues.slice(0, -1).every((v) => Math.abs(v) > EPSILON);
    if (nonZeroBase) {
      const ratios = seedValues.slice(1).map((v, i) => v / seedValues[i]);
      const isGeometric = ratios.every((r) => Math.abs(r - ratios[0]) < EPSILON);
      if (isGeometric) {
        const ratio = ratios[0];
        let current = seedValues[seedValues.length - 1];
        const result: number[] = [];
        for (let i = 0; i < targetCount; i++) {
          current *= ratio;
          result.push(current);
        }
        return { pattern: 'Geometric', values: result };
      }
    }

    const secondDiffs = diffs.slice(1).map((v, i) => v - diffs[i]);
    const isSecondOrder = secondDiffs.length > 0 && secondDiffs.every((d) => Math.abs(d - secondDiffs[0]) < EPSILON);
    if (isSecondOrder) {
      const second = secondDiffs[0];
      let current = seedValues[seedValues.length - 1];
      let currentDiff = diffs[diffs.length - 1];
      const result: number[] = [];
      for (let i = 0; i < targetCount; i++) {
        currentDiff += second;
        current += currentDiff;
        result.push(current);
      }
      return { pattern: 'Second-order arithmetic', values: result };
    }

    return { pattern: '', values: [] as number[] };
  }, []);

  const selectionContext: SelectionContext = useMemo(() => {
    if (selectedCells.size < 3) return null;
    if (resolvedRows.length === 0) return null;

    let matchedProperty: PropertyConfig | null = null;
    let selectedRowIds: string[] = [];

    for (const property of orderedProperties) {
      const suffix = `-${property.key}`;
      const ids = Array.from(selectedCells)
        .filter((cellKey) => cellKey.endsWith(suffix))
        .map((cellKey) => cellKey.slice(0, cellKey.length - suffix.length));
      if (ids.length === selectedCells.size) {
        matchedProperty = property;
        selectedRowIds = ids;
        break;
      }
    }

    if (!matchedProperty || selectedRowIds.length < 3) return null;
    const uniqueRowIds = Array.from(new Set(selectedRowIds));
    if (uniqueRowIds.length < 3) return null;

    const rowIndexMap = new Map<string, number>();
    resolvedRows.forEach((row, index) => rowIndexMap.set(row.id, index));
    const sortedIndices = uniqueRowIds
      .map((id) => rowIndexMap.get(id))
      .filter((v): v is number => typeof v === 'number')
      .sort((a, b) => a - b);
    if (sortedIndices.length < 3) return null;
    for (let i = 1; i < sortedIndices.length; i++) {
      if (sortedIndices[i] !== sortedIndices[i - 1] + 1) return null;
    }

    const seedValues = sortedIndices.map((rowIndex) => {
      const rawValue = resolvedRows[rowIndex]?.propertyValues?.[matchedProperty!.key];
      return typeof rawValue === 'number' ? rawValue : Number(rawValue);
    });
    if (seedValues.some((v) => !Number.isFinite(v))) return null;

    return {
      property: matchedProperty,
      values: seedValues,
      startTargetIndex: sortedIndices[sortedIndices.length - 1] + 1,
    };
  }, [selectedCells, orderedProperties, resolvedRows]);

  const openModal = useCallback(() => {
    if (!selectionContext) {
      window.alert('Please select at least 3 continuous numeric cells in one column.');
      return;
    }

    const prediction = getPredictedValues(selectionContext.values, 10);
    if (!prediction.pattern || prediction.values.length === 0) {
      window.alert('No clear pattern detected. Please fill manually.');
      return;
    }

    const inferPrecision = selectionContext.property.dataType === 'float'
      ? selectionContext.values.reduce((max, v) => {
          const text = String(v);
          const dot = text.indexOf('.');
          const places = dot >= 0 ? text.length - dot - 1 : 0;
          return Math.max(max, places);
        }, 0)
      : 0;

    const defaultCount = Math.min(Math.max(selectionContext.values.length, 1), 50);
    const adjusted = getPredictedValues(selectionContext.values, defaultCount);

    setPatternName(prediction.pattern);
    setPropertyKey(selectionContext.property.key);
    setStartRowIndex(selectionContext.startTargetIndex);
    setPrecision(inferPrecision);
    setCount(defaultCount);
    setValues(adjusted.values.map((v) => Number(v.toFixed(Math.min(Math.max(inferPrecision, 0), 6)))));
    setOpen(true);
  }, [selectionContext, getPredictedValues]);

  const onCountChange = useCallback((value: number | null) => {
    const next = Math.min(Math.max(value ?? 10, 1), 50);
    setCount(next);
    if (!selectionContext) return;
    const prediction = getPredictedValues(selectionContext.values, next);
    setPatternName(prediction.pattern);
    setValues(prediction.values.map((v) => Number(v.toFixed(Math.min(Math.max(precision, 0), 6)))));
  }, [selectionContext, getPredictedValues, precision]);

  const onValueChange = useCallback((index: number, next: number | null) => {
    const n = typeof next === 'number' ? next : Number(next ?? 0);
    setValues((prev) => {
      const copy = [...prev];
      copy[index] = Number.isFinite(n) ? n : 0;
      return copy;
    });
  }, []);

  const apply = useCallback(async () => {
    if (!selectionContext || propertyKey === null || startRowIndex === null) {
      setOpen(false);
      return;
    }
    if (!onUpdateAsset && !onUpdateAssets && !onSaveAsset) return;

    const allRows = resolvedRows;
    const persistedRowIds = new Set(rows.map((r) => r.id));
    const targetProperty = orderedProperties.find((p) => p.key === propertyKey);
    const writeFixedFloat = targetProperty?.dataType === 'float' && precision > 0;
    const updates: Array<{ assetId: string; assetName: string; propertyValues: Record<string, any> }> = [];
    const valuesForCreate: number[] = [];
    let hasExistingData = false;

    for (let i = 0; i < values.length; i++) {
      const row = allRows[startRowIndex + i];
      const nextValue = values[i];
      if (!row || row.id.startsWith('temp-') || !persistedRowIds.has(row.id)) {
        valuesForCreate.push(nextValue);
        continue;
      }
      const oldVal = row.propertyValues?.[propertyKey];
      if (oldVal !== null && oldVal !== undefined && oldVal !== '') hasExistingData = true;
      updates.push({
        assetId: row.id,
        assetName: row.name || 'Untitled',
        propertyValues: { [propertyKey]: writeFixedFloat ? nextValue.toFixed(precision) : nextValue },
      });
    }

    if (updates.length === 0 && valuesForCreate.length === 0) {
      window.alert('No target rows to apply.');
      return;
    }
    if (hasExistingData && !window.confirm('Target cells already contain data. Overwrite?')) {
      return;
    }

    setIsSaving(true);
    try {
      if (updates.length > 1 && onUpdateAssets) {
        await onUpdateAssets(updates);
      } else if (onUpdateAsset) {
        await Promise.all(updates.map((u) => onUpdateAsset(u.assetId, u.assetName, u.propertyValues)));
      }

      if (valuesForCreate.length > 0 && onSaveAsset) {
        const createStartVisualIndex = startRowIndex + updates.length;
        const anchorVisualIndex = Math.max(createStartVisualIndex - 1, 0);
        const anchorRow = allRows[anchorVisualIndex];
        const defaultAnchorRowIndex = anchorVisualIndex + 1;
        const anchorRowIndex = typeof anchorRow?.rowIndex === 'number' ? anchorRow.rowIndex : defaultAnchorRowIndex;
        const baseInsertRowIndex = anchorRowIndex + 1;
        const tempIds: string[] = [];

        if (supabase && library) {
          await shiftRowIndices(supabase, library.id, baseInsertRowIndex, valuesForCreate.length);
        }

        if (yRows && setOptimisticNewAssets) {
          const optimisticRows: AssetRow[] = valuesForCreate.map((value, i) => {
            const tempId = `temp-ai-predict-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 9)}`;
            tempIds.push(tempId);
            return {
              id: tempId,
              libraryId: library?.id ?? '',
              name: `Predicted ${updates.length + i + 1}`,
              propertyValues: { [propertyKey]: writeFixedFloat ? value.toFixed(precision) : value },
              rowIndex: baseInsertRowIndex + i,
            };
          });
          yRows.insert(createStartVisualIndex, optimisticRows);
          setOptimisticNewAssets((prev) => {
            const next = new Map(prev);
            optimisticRows.forEach((row) => next.set(row.id, row));
            return next;
          });
          if (setOptimisticInsertIndices) {
            setOptimisticInsertIndices((prev) => {
              const next = new Map(prev);
              optimisticRows.forEach((row, i) => next.set(row.id, createStartVisualIndex + i));
              return next;
            });
          }
        }

        for (let i = 0; i < valuesForCreate.length; i++) {
          const value = valuesForCreate[i];
          const propertyValues = { [propertyKey]: writeFixedFloat ? value.toFixed(precision) : value };
          await onSaveAsset(`Predicted ${updates.length + i + 1}`, propertyValues, {
            rowIndex: baseInsertRowIndex + i,
            skipReload: i !== valuesForCreate.length - 1,
          });
        }

        if (tempIds.length > 0 && yRows && setOptimisticNewAssets) {
          setTimeout(() => {
            const current = yRows.toArray();
            for (let i = current.length - 1; i >= 0; i--) {
              if (tempIds.includes(current[i].id)) yRows.delete(i, 1);
            }
            setOptimisticNewAssets((prev) => {
              const next = new Map(prev);
              tempIds.forEach((id) => next.delete(id));
              return next;
            });
            if (setOptimisticInsertIndices) {
              setOptimisticInsertIndices((prev) => {
                const next = new Map(prev);
                tempIds.forEach((id) => next.delete(id));
                return next;
              });
            }
          }, 500);
        }
      }

      setOpen(false);
    } catch (error) {
      console.error('Failed to apply predicted values:', error);
      window.alert('Failed to apply predicted values.');
    } finally {
      setIsSaving(false);
    }
  }, [
    selectionContext,
    propertyKey,
    startRowIndex,
    values,
    rows,
    orderedProperties,
    precision,
    onUpdateAsset,
    onUpdateAssets,
    onSaveAsset,
    resolvedRows,
    supabase,
    library,
    setIsSaving,
    yRows,
    setOptimisticNewAssets,
    setOptimisticInsertIndices,
  ]);

  return {
    showAiPredictNext: !!selectionContext,
    openModal,
    modal: {
      open,
      patternName,
      propertyKey,
      count,
      values,
      precision,
      onCancel: () => setOpen(false),
      onOk: () => void apply(),
      onCountChange,
      onValueChange,
    },
  };
}

