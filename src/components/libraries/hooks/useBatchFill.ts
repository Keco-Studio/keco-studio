import { useCallback } from 'react';
import type { AssetRow, PropertyConfig } from '@/lib/types/libraryAssets';
import type { useTableDataManager } from './useTableDataManager';
import { serializeError } from '@/lib/utils/errorUtils';

type DataManager = ReturnType<typeof useTableDataManager>;

/**
 * useBatchFill - Handle batch fill operations (fill down, fill up, fill right, fill left)
 * 
 * Core responsibilities:
 * - Extract batch fill logic from main component
 * - Use getRowBaseValue() to get source values (critical fix)
 * - Manage optimistic updates correctly
 * - Handle save operations with proper data merging
 */
export function useBatchFill({
  dataManager,
  orderedProperties,
  getAllRowsForCellSelection,
  onUpdateAsset,
  onUpdateAssets,
  setOptimisticEditUpdates,
  optimisticEditUpdates,
}: {
  dataManager: DataManager;
  orderedProperties: PropertyConfig[];
  getAllRowsForCellSelection: () => AssetRow[];
  onUpdateAsset?: (assetId: string, assetName: string, propertyValues: Record<string, any>) => Promise<void>;
  onUpdateAssets?: (updates: Array<{ assetId: string; assetName: string; propertyValues: Record<string, any> }>) => Promise<void>;
  setOptimisticEditUpdates: React.Dispatch<React.SetStateAction<Map<string, { name: string; propertyValues: Record<string, any> }>>>;
  optimisticEditUpdates: Map<string, { name: string; propertyValues: Record<string, any> }>;
}) {
  /**
   * Fill down - Fill cells from start row to end row with source value
   * This is the main fill operation used in the current implementation
   */
  const fillDown = useCallback(async (
    startRowId: string,
    endRowId: string,
    propertyKey: string
  ): Promise<void> => {
    if (!onUpdateAsset) {
      console.warn('onUpdateAsset is not provided');
      return;
    }

    // Get fresh data right before filling to ensure we have the latest values
    const allRowsForFill = getAllRowsForCellSelection();
    
    // Find indices
    const freshStartRowIndex = allRowsForFill.findIndex(r => r.id === startRowId);
    const freshEndRowIndex = allRowsForFill.findIndex(r => r.id === endRowId);
    
    // Validate indices
    if (freshStartRowIndex === -1 || freshEndRowIndex === -1 || freshEndRowIndex <= freshStartRowIndex) {
      console.warn('Invalid fill indices:', { freshStartRowIndex, freshEndRowIndex });
      return;
    }
    
    const sourceProperty = orderedProperties.find(p => p.key === propertyKey);
    if (!sourceProperty) {
      console.warn('Property not found:', propertyKey);
      return;
    }
    
    // CRITICAL FIX: Get source value from base data source (not from optimistic updates)
    // This ensures we get the latest saved value, not a stale optimistic update
    const sourceValue = dataManager.getRowBaseValue(startRowId, propertyKey);
    
    // Collect all cells that need to be filled
    const fillUpdates: Array<{ rowId: string; propertyKey: string; value: any }> = [];
    
    for (let r = freshStartRowIndex + 1; r <= freshEndRowIndex; r++) {
      if (r >= allRowsForFill.length) {
        console.warn(`Row index ${r} is out of bounds (array length: ${allRowsForFill.length})`);
        continue;
      }
      
      const targetRow = allRowsForFill[r];
      if (!targetRow) {
        console.warn(`Row at index ${r} is undefined`);
        continue;
      }
      
      // Store the fill operation info
      fillUpdates.push({
        rowId: targetRow.id,
        propertyKey: propertyKey,
        value: sourceValue
      });
    }
    
    if (fillUpdates.length === 0) {
      return;
    }
    
    // CRITICAL FIX: Calculate merged optimistic updates BEFORE updating state
    // This ensures we use the latest optimistic updates when building save data
    const mergedOptimisticUpdates = new Map(optimisticEditUpdates);
    fillUpdates.forEach(({ rowId, propertyKey, value }) => {
      const existingUpdate = mergedOptimisticUpdates.get(rowId);
      if (existingUpdate) {
        // Merge: preserve existing optimistic updates, only update the target property
        mergedOptimisticUpdates.set(rowId, {
          name: existingUpdate.name,
          propertyValues: {
            ...existingUpdate.propertyValues,
            [propertyKey]: value
          }
        });
      } else {
        // No existing optimistic update, get BASE row data (not from allRowsForFill which may contain old optimistic updates)
        // CRITICAL FIX: Use base data source to avoid copying old optimistic updates from other columns
        const baseRow = dataManager.getRowBaseValue(rowId);
        if (baseRow) {
          // Create new optimistic update with ONLY the target property changed.
          // IMPORTANT: Do NOT store a full row snapshot here, otherwise later cleanup/removal
          // can cause other columns to flicker or revert.
          mergedOptimisticUpdates.set(rowId, {
            name: baseRow.name,
            propertyValues: {
              [propertyKey]: value
            }
          });
        }
      }
    });
    
    // Apply optimistic updates IMMEDIATELY for better UX
    // IMPORTANT: Only update the target property, preserve other properties
    setOptimisticEditUpdates(mergedOptimisticUpdates);
    
    // Prepare all update data using the merged optimistic updates
    const updateDataMap = new Map<string, { 
      rowId: string; 
      rowName: string; 
      propertyKey: string;
      fillValue: any;
      propertyValues: Record<string, any> 
    }>();
    
    // Check if we're filling the name field (identified by label='name' and dataType='string')
    const nameFieldProperty = orderedProperties.find(p => p.name === 'name' && p.dataType === 'string');
    const isFillingNameField = nameFieldProperty?.key === propertyKey;
    const nameFieldKey = nameFieldProperty?.key;
    
    fillUpdates.forEach(({ rowId, propertyKey, value }) => {
      // CRITICAL FIX: Get base row data using dataManager (ensures we get fresh base data)
      const baseRow = dataManager.getRowBaseValue(rowId);
      if (!baseRow) {
        console.warn(`Row ${rowId} not found for fill update`);
        return;
      }
      
      // Get merged optimistic update (includes the fill value we just added)
      const mergedOptimisticUpdate = mergedOptimisticUpdates.get(rowId);
      
      // Build propertyValues: start with BASE row data, then only add the fill value
      // CRITICAL: Only save the filled property, keep other columns' optimistic updates as optimistic
      let propertyValuesToSave: Record<string, any>;
      let rowNameToSave: string;
      
      if (mergedOptimisticUpdate) {
        // Start with baseRow.propertyValues (fresh from data source), then only add the fill value
        propertyValuesToSave = {
          ...baseRow.propertyValues,
          [propertyKey]: value  // Only save the filled property, keep other columns' optimistic updates
        };
        
        // For name field, use the optimistic update name if it exists
        // Otherwise, use baseRow.name
        rowNameToSave = mergedOptimisticUpdate.name || baseRow.name;
      } else {
        // No optimistic update (shouldn't happen after merge, but handle it)
        propertyValuesToSave = {
          ...baseRow.propertyValues,
          [propertyKey]: value
        };
        
        // If not filling name field, ensure name field value is preserved from baseRow
        if (!isFillingNameField && nameFieldKey) {
          // Preserve the current name field value from baseRow
          const currentNameValue = baseRow.propertyValues[nameFieldKey];
          if (currentNameValue === null || currentNameValue === undefined || currentNameValue === '') {
            // Name was cleared, keep it cleared
            propertyValuesToSave[nameFieldKey] = null;
            rowNameToSave = ''; // Empty name
          } else {
            // Name has a value, use it
            rowNameToSave = String(currentNameValue);
          }
        } else {
          // Filling name field or no name field, use baseRow.name
          rowNameToSave = baseRow.name;
        }
      }
      
      updateDataMap.set(rowId, {
        rowId,
        rowName: rowNameToSave,
        propertyKey,
        fillValue: value,
        propertyValues: propertyValuesToSave
      });
    });
    
    // 与 delete row 一致：多行走批量接口
    const batchUpdates = Array.from(updateDataMap.entries()).map(([, data]) => ({
      assetId: data.rowId,
      assetName: data.rowName,
      propertyValues: data.propertyValues,
    }));

    if (batchUpdates.length > 1 && onUpdateAssets) {
      try {
        await onUpdateAssets(batchUpdates);
      } catch (error) {
        console.error('Batch fill failed:', serializeError(error));
        // On error, clear optimistic for all filled rows
        setOptimisticEditUpdates(prev => {
          const newMap = new Map(prev);
          fillUpdates.forEach(({ rowId, propertyKey }) => {
            const currentUpdate = newMap.get(rowId);
            if (currentUpdate) {
              const updatedPropertyValues = { ...currentUpdate.propertyValues };
              delete updatedPropertyValues[propertyKey];
              if (Object.keys(updatedPropertyValues).length > 0) {
                newMap.set(rowId, { name: currentUpdate.name, propertyValues: updatedPropertyValues });
              } else {
                newMap.delete(rowId);
              }
            }
          });
          return newMap;
        });
        throw error;
      }
    } else {
      // 单行或无批量接口：沿用原逻辑
      const updates: Array<Promise<void>> = [];
      updateDataMap.forEach(({ rowId, rowName, propertyKey, propertyValues }) => {
        updates.push(
          onUpdateAsset!(rowId, rowName, propertyValues)
            .catch(error => {
              console.error(`Failed to fill cell ${rowId}-${propertyKey}:`, serializeError(error));
              setOptimisticEditUpdates(prev => {
                const newMap = new Map(prev);
                const currentUpdate = newMap.get(rowId);
                if (currentUpdate) {
                  const updatedPropertyValues = { ...currentUpdate.propertyValues };
                  delete updatedPropertyValues[propertyKey];
                  if (Object.keys(updatedPropertyValues).length > 0) {
                    newMap.set(rowId, { name: currentUpdate.name, propertyValues: updatedPropertyValues });
                  } else {
                    newMap.delete(rowId);
                  }
                }
                return newMap;
              });
              throw error;
            })
        );
      });
      const results = await Promise.allSettled(updates);
      const failures = results.filter(r => r.status === 'rejected');
      if (failures.length > 0) {
        console.warn(`Batch fill completed with ${failures.length} failures out of ${updates.length} updates`);
      }
    }
  }, [
    dataManager,
    orderedProperties,
    getAllRowsForCellSelection,
    onUpdateAsset,
    onUpdateAssets,
    setOptimisticEditUpdates,
    optimisticEditUpdates,
  ]);

  return {
    fillDown,
    // Future: fillUp, fillRight, fillLeft can be added here
  };
}
