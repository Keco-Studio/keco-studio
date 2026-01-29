import { useCallback, useMemo } from 'react';
import type { AssetRow } from '@/lib/types/libraryAssets';

/**
 * Optimistic update data structure
 */
export type OptimisticEditUpdate = {
  name: string;
  propertyValues: Record<string, any>;
};

/**
 * useTableDataManager - Unified management of table data source and optimistic updates
 * 
 * Core responsibilities:
 * - Manage base data source (unaffected by optimistic updates)
 * - Manage optimistic update state
 * - Provide data access interfaces (base value vs latest value)
 * - Provide optimistic update management methods
 */
export function useTableDataManager({
  baseRows, // Base data source (from Yjs or props.rows)
  optimisticEditUpdates, // Optimistic edit updates: { rowId: { name, propertyValues } }
  optimisticNewAssets, // Optimistic new assets: { tempId: AssetRow }
  deletedAssetIds, // Set of deleted asset IDs
}: {
  baseRows: AssetRow[];
  optimisticEditUpdates: Map<string, OptimisticEditUpdate>;
  optimisticNewAssets: Map<string, AssetRow>;
  deletedAssetIds: Set<string>;
}) {
  /**
   * Get base row data (unaffected by optimistic updates)
   * Critical fix: Ensure we get values from base data source, not from data that includes optimistic updates
   */
  const getRowBaseValue = useCallback((rowId: string, propertyKey?: string): any => {
    const baseRow = baseRows.find(r => r.id === rowId);
    if (!baseRow) {
      return null;
    }
    
    // If propertyKey is specified, return the base value of that property
    if (propertyKey !== undefined) {
      return baseRow.propertyValues[propertyKey] ?? null;
    }
    
    // Otherwise return the entire base row
    return baseRow;
  }, [baseRows]);

  /**
   * Get the latest value of a row (including optimistic updates)
   */
  const getRowValue = useCallback((rowId: string, propertyKey?: string): any => {
    // First check if it's a new optimistic asset
    const optimisticNewAsset = optimisticNewAssets.get(rowId);
    if (optimisticNewAsset) {
      if (propertyKey !== undefined) {
        return optimisticNewAsset.propertyValues[propertyKey] ?? null;
      }
      return optimisticNewAsset;
    }
    
    // Get base row
    const baseRow = baseRows.find(r => r.id === rowId);
    if (!baseRow) {
      return null;
    }
    
    // Check if there are optimistic updates
    const optimisticUpdate = optimisticEditUpdates.get(rowId);
    
    if (propertyKey !== undefined) {
      // Return the latest value of the specified property
      if (optimisticUpdate && optimisticUpdate.propertyValues.hasOwnProperty(propertyKey)) {
        return optimisticUpdate.propertyValues[propertyKey];
      }
      return baseRow.propertyValues[propertyKey] ?? null;
    }
    
    // Return the latest value of the entire row
    if (optimisticUpdate) {
      return {
        ...baseRow,
        name: optimisticUpdate.name,
        propertyValues: {
          ...baseRow.propertyValues,
          ...optimisticUpdate.propertyValues,
        },
      };
    }
    
    return baseRow;
  }, [baseRows, optimisticEditUpdates, optimisticNewAssets]);

  /**
   * Get complete row list with optimistic updates (for rendering and selection)
   * This function replaces the original getAllRowsForCellSelection
   */
  const getRowsWithOptimisticUpdates = useCallback((): AssetRow[] => {
    const allRowsMap = new Map<string, AssetRow>();
    
    // Add base rows (excluding deleted ones)
    baseRows.forEach(row => {
      if (!deletedAssetIds.has(row.id)) {
        const assetRow = row as AssetRow;
        const optimisticUpdate = optimisticEditUpdates.get(assetRow.id);
        
        // Always overlay optimistic when present. Requiring name match caused
        // "清空某列导致其他列恢复" when clearing name column (base refetched as '' but optimistic.name stayed old).
        if (optimisticUpdate) {
          allRowsMap.set(assetRow.id, {
            ...assetRow,
            name: optimisticUpdate.name,
            propertyValues: { ...assetRow.propertyValues, ...optimisticUpdate.propertyValues }
          });
        } else {
          allRowsMap.set(assetRow.id, assetRow);
        }
      }
    });
    
    // Add optimistic new assets
    optimisticNewAssets.forEach((asset, id) => {
      if (!allRowsMap.has(id)) {
        allRowsMap.set(id, asset);
      }
    });
    
    // Convert to array, maintain order (based on baseRows order)
    const allRows: AssetRow[] = [];
    const processedIds = new Set<string>();
    
    // First add in baseRows order
    baseRows.forEach(row => {
      if (!deletedAssetIds.has(row.id) && !processedIds.has(row.id)) {
        const rowToAdd = allRowsMap.get(row.id);
        if (rowToAdd) {
          allRows.push(rowToAdd);
          processedIds.add(row.id);
        }
      }
    });
    
    // Then add optimistic new assets (not in baseRows)
    optimisticNewAssets.forEach((asset, id) => {
      if (!processedIds.has(id)) {
        allRows.push(asset);
        processedIds.add(id);
      }
    });
    
    return allRows;
  }, [baseRows, deletedAssetIds, optimisticEditUpdates, optimisticNewAssets]);

  /**
   * Set optimistic update for a single property
   * Only update the target property, preserve optimistic updates for other properties
   */
  const setOptimisticUpdate = useCallback((
    setOptimisticEditUpdates: React.Dispatch<React.SetStateAction<Map<string, OptimisticEditUpdate>>>,
    rowId: string,
    propertyKey: string,
    value: any
  ) => {
    setOptimisticEditUpdates(prev => {
      const newMap = new Map(prev);
      const existingUpdate = newMap.get(rowId);
      
      // Get base row data
      const baseRow = baseRows.find(r => r.id === rowId);
      if (!baseRow) {
        return prev;
      }
      
      if (existingUpdate) {
        // Merge: preserve existing optimistic updates, only update target property
        newMap.set(rowId, {
          name: existingUpdate.name,
          propertyValues: {
            ...existingUpdate.propertyValues,
            [propertyKey]: value,
          },
        });
      } else {
        // Create new optimistic update, only include target property
        newMap.set(rowId, {
          name: baseRow.name,
          propertyValues: {
            ...baseRow.propertyValues,
            [propertyKey]: value,
          },
        });
      }
      
      return newMap;
    });
  }, [baseRows]);

  /**
   * Clear optimistic update for a specified property
   * If this property is the only optimistic update, clear the entire row's optimistic update
   */
  const clearOptimisticUpdate = useCallback((
    setOptimisticEditUpdates: React.Dispatch<React.SetStateAction<Map<string, OptimisticEditUpdate>>>,
    rowId: string,
    propertyKey: string
  ) => {
    setOptimisticEditUpdates(prev => {
      const newMap = new Map(prev);
      const currentUpdate = newMap.get(rowId);
      
      if (currentUpdate) {
        // Remove specified property
        const updatedPropertyValues = { ...currentUpdate.propertyValues };
        delete updatedPropertyValues[propertyKey];
        
        if (Object.keys(updatedPropertyValues).length > 0) {
          // There are other optimistic updates, keep them
          newMap.set(rowId, {
            name: currentUpdate.name,
            propertyValues: updatedPropertyValues,
          });
        } else {
          // No other optimistic updates, delete the entire entry
          newMap.delete(rowId);
        }
      }
      
      return newMap;
    });
  }, []);

  /**
   * Clear optimistic update for the entire row
   */
  const clearRowOptimisticUpdate = useCallback((
    setOptimisticEditUpdates: React.Dispatch<React.SetStateAction<Map<string, OptimisticEditUpdate>>>,
    rowId: string
  ) => {
    setOptimisticEditUpdates(prev => {
      const newMap = new Map(prev);
      newMap.delete(rowId);
      return newMap;
    });
  }, []);

  // Use useMemo to stabilize the returned object reference
  // This prevents infinite loops when used as a dependency in other hooks
  return useMemo(() => ({
    // Data access methods
    getRowBaseValue, // Critical fix: Get value from base data source
    getRowValue, // Get latest value (including optimistic updates)
    getRowsWithOptimisticUpdates, // Get complete row list (for rendering)
    
    // Optimistic update management methods
    setOptimisticUpdate,
    clearOptimisticUpdate,
    clearRowOptimisticUpdate,
  }), [
    getRowBaseValue,
    getRowValue,
    getRowsWithOptimisticUpdates,
    setOptimisticUpdate,
    clearOptimisticUpdate,
    clearRowOptimisticUpdate,
  ]);
}
