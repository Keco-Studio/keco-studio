import { useState, useEffect, useCallback } from 'react';
import type { AssetRow, PropertyConfig } from '@/lib/types/libraryAssets';
import type { SupabaseClient } from '@supabase/supabase-js';

// Compatible interface for yRows (supports both Y.Array and mock objects)
interface YRowsLike {
  length: number;
  toArray: () => AssetRow[];
  insert: (index: number, content: AssetRow[]) => void;
  delete: (index: number, length: number) => void;
}

export type UseReferenceModalParams = {
  setNewRowData: React.Dispatch<React.SetStateAction<Record<string, any>>>;
  allRowsSource: AssetRow[];
  yRows: YRowsLike;
  onUpdateAsset?: (assetId: string, assetName: string, propertyValues: Record<string, any>) => Promise<void>;
  rows: AssetRow[];
  newRowData: Record<string, any>;
  properties: PropertyConfig[];
  editingCell: { rowId: string; propertyKey: string } | null;
  isAddingRow: boolean;
  supabase: SupabaseClient | null;
  setOptimisticEditUpdates: React.Dispatch<React.SetStateAction<Map<string, { name: string; propertyValues: Record<string, any> }>>>;
};

/**
 * useReferenceModal - Reference 选择弹窗：状态、assetNames 缓存、加载、打开/应用/关闭
 */
export function useReferenceModal(params: UseReferenceModalParams) {
  const {
    setNewRowData,
    allRowsSource,
    yRows,
    onUpdateAsset,
    rows,
    newRowData,
    properties,
    editingCell,
    isAddingRow,
    supabase,
    setOptimisticEditUpdates,
  } = params;

  const [referenceModalOpen, setReferenceModalOpen] = useState(false);
  const [referenceModalProperty, setReferenceModalProperty] = useState<PropertyConfig | null>(null);
  const [referenceModalValue, setReferenceModalValue] = useState<string | null>(null);
  const [referenceModalRowId, setReferenceModalRowId] = useState<string | null>(null);
  const [assetNamesCache, setAssetNamesCache] = useState<Record<string, string>>({});

  // Load asset names by ID from reference fields (using first column value)
  useEffect(() => {
    const loadAssetNames = async () => {
      const assetIds = new Set<string>();
      rows.forEach((row) => {
        properties.forEach((prop) => {
          if (prop.dataType === 'reference') {
            const value = row.propertyValues[prop.key];
            if (value && typeof value === 'string') assetIds.add(value);
          }
        });
      });
      if (isAddingRow) {
        properties.forEach((prop) => {
          if (prop.dataType === 'reference') {
            const value = newRowData[prop.key];
            if (value && typeof value === 'string') assetIds.add(value);
          }
        });
      }
      if (assetIds.size === 0 || !supabase) return;
      try {
        // Get assets
        const { data: assetsData, error: assetsError } = await supabase
          .from('library_assets')
          .select('id, library_id')
          .in('id', Array.from(assetIds));
        if (assetsError) throw assetsError;

        const namesMap: Record<string, string> = {};
        
        // For each asset, get the first column value
        for (const asset of assetsData || []) {
          // Get first column field definition
          const { data: fieldDefs, error: fieldError } = await supabase
            .from('library_field_definitions')
            .select('id')
            .eq('library_id', asset.library_id)
            .order('order_index', { ascending: true })
            .limit(1);

          if (fieldError) continue;

          const firstFieldId = fieldDefs && fieldDefs.length > 0 ? fieldDefs[0].id : null;
          
          if (firstFieldId) {
            // Get first column value
            const { data: valueData, error: valueError } = await supabase
              .from('library_asset_values')
              .select('value_json')
              .eq('asset_id', asset.id)
              .eq('field_id', firstFieldId)
              .single();

            if (!valueError && valueData?.value_json !== null && valueData?.value_json !== undefined) {
              const rawValue = valueData.value_json;
              const strValue = String(rawValue).trim();
              if (strValue !== '' && strValue !== 'null' && strValue !== 'undefined') {
                namesMap[asset.id] = strValue;
              } else {
                namesMap[asset.id] = 'Untitled';
              }
            } else {
              namesMap[asset.id] = 'Untitled';
            }
          } else {
            namesMap[asset.id] = 'Untitled';
          }
        }

        setAssetNamesCache((prev) => ({ ...prev, ...namesMap }));
      } catch (e) {
        console.error('Failed to load asset names:', e);
      }
    };
    loadAssetNames();
  }, [rows, newRowData, properties, editingCell, isAddingRow, supabase]);

  // Refresh asset name cache only; do NOT clear optimistic here (useOptimisticCleanup clears when rows match)
  useEffect(() => {
    const handleAssetUpdated = async (event: Event) => {
      const ev = event as CustomEvent<{ assetId: string; libraryId?: string }>;
      if (!ev.detail?.assetId || !supabase) return;
      try {
        const { data, error } = await supabase
          .from('library_assets')
          .select('id, library_id')
          .eq('id', ev.detail.assetId)
          .single();
        if (error || !data) return;

        // Get first column field definition
        const { data: fieldDefs, error: fieldError } = await supabase
          .from('library_field_definitions')
          .select('id')
          .eq('library_id', data.library_id)
          .order('order_index', { ascending: true })
          .limit(1);

        if (fieldError) return;

        const firstFieldId = fieldDefs && fieldDefs.length > 0 ? fieldDefs[0].id : null;
        
        if (firstFieldId) {
          // Get first column value
          const { data: valueData, error: valueError } = await supabase
            .from('library_asset_values')
            .select('value_json')
            .eq('asset_id', data.id)
            .eq('field_id', firstFieldId)
            .single();

          if (!valueError && valueData?.value_json !== null && valueData?.value_json !== undefined) {
            const rawValue = valueData.value_json;
            const strValue = String(rawValue).trim();
            if (strValue !== '' && strValue !== 'null' && strValue !== 'undefined') {
              setAssetNamesCache((prev) => ({ ...prev, [data.id]: strValue }));
            } else {
              setAssetNamesCache((prev) => ({ ...prev, [data.id]: 'Untitled' }));
            }
          } else {
            setAssetNamesCache((prev) => ({ ...prev, [data.id]: 'Untitled' }));
          }
        } else {
          setAssetNamesCache((prev) => ({ ...prev, [data.id]: 'Untitled' }));
        }
      } catch (e) {
        console.error('Failed to refresh asset name:', e);
      }
    };
    window.addEventListener('assetUpdated', handleAssetUpdated as EventListener);
    return () => window.removeEventListener('assetUpdated', handleAssetUpdated as EventListener);
  }, [supabase]);

  const handleOpenReferenceModal = useCallback((property: PropertyConfig, currentValue: string | null, rowId: string) => {
    setReferenceModalProperty(property);
    setReferenceModalValue(currentValue);
    setReferenceModalRowId(rowId);
    setReferenceModalOpen(true);
  }, []);

  const handleApplyReference = useCallback(async (assetId: string | null) => {
    if (!referenceModalProperty || !referenceModalRowId) return;
    if (referenceModalRowId === 'new') {
      setNewRowData((prev) => ({ ...prev, [referenceModalProperty.key]: assetId }));
    } else {
      const row = allRowsSource.find((r) => r.id === referenceModalRowId);
      if (row && onUpdateAsset) {
        const arr = yRows.toArray();
        const rowIndex = arr.findIndex((r) => r.id === referenceModalRowId);
        if (rowIndex >= 0) {
          const updatedPropertyValues = { ...row.propertyValues, [referenceModalProperty.key]: assetId };
          yRows.delete(rowIndex, 1);
          yRows.insert(rowIndex, [{ ...row, propertyValues: updatedPropertyValues }]);
        }
        const toSave = { ...row.propertyValues, [referenceModalProperty.key]: assetId };
        await onUpdateAsset(row.id, row.name, toSave);
      }
    }
    setReferenceModalOpen(false);
    setReferenceModalProperty(null);
    setReferenceModalValue(null);
    setReferenceModalRowId(null);
  }, [referenceModalProperty, referenceModalRowId, setNewRowData, allRowsSource, yRows, onUpdateAsset]);

  const handleCloseReferenceModal = useCallback(() => {
    setReferenceModalOpen(false);
    setReferenceModalProperty(null);
    setReferenceModalValue(null);
    setReferenceModalRowId(null);
  }, []);

  return {
    referenceModalOpen,
    referenceModalProperty,
    referenceModalValue,
    referenceModalRowId,
    assetNamesCache,
    handleOpenReferenceModal,
    handleApplyReference,
    handleCloseReferenceModal,
  };
}
