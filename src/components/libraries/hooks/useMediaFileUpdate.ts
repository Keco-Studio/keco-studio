import { useState, useCallback } from 'react';
import { AssetRow } from '@/lib/types/libraryAssets';
import { MediaFileMetadata } from '@/lib/services/mediaFileUploadService';

export interface UseMediaFileUpdateParams {
  rows: AssetRow[];
  onUpdateAsset?: (assetId: string, assetName: string, propertyValues: Record<string, any>) => Promise<void>;
  setOptimisticEditUpdates: React.Dispatch<React.SetStateAction<Map<string, { name: string; propertyValues: Record<string, any> }>>>;
  setIsSaving: React.Dispatch<React.SetStateAction<boolean>>;
  getAllRowsForCellSelection: () => AssetRow[];
}

/**
 * Hook to handle media file updates with optimistic UI updates
 * Handles immediate save of media files (images/files) when changed
 */
export function useMediaFileUpdate({
  rows,
  onUpdateAsset,
  setOptimisticEditUpdates,
  setIsSaving,
  getAllRowsForCellSelection,
}: UseMediaFileUpdateParams) {
  
  /**
   * Handle media file change for editing cell (with immediate save)
   */
  const handleMediaFileChange = useCallback((
    rowId: string,
    propertyKey: string,
    value: MediaFileMetadata | null
  ) => {
    if (!onUpdateAsset) return;
    
    const row = rows.find(r => r.id === rowId);
    if (!row) {
      // Try to find in allRowsSource if not in rows
      const allRowsForSelection = getAllRowsForCellSelection();
      const foundRow = allRowsForSelection.find(r => r.id === rowId);
      if (!foundRow) return;
      
      const updatedPropertyValues: Record<string, any> = {
        ...foundRow.propertyValues,
        [propertyKey]: value
      };
      
      // Get asset name
      const assetName = foundRow.name || 'Untitled';

      // Apply optimistic update
      setOptimisticEditUpdates(prev => {
        const newMap = new Map(prev);
        newMap.set(rowId, {
          name: String(assetName),
          propertyValues: updatedPropertyValues
        });
        return newMap;
      });

      // Save immediately for media files
      setIsSaving(true);
      onUpdateAsset(rowId, assetName, updatedPropertyValues)
        .then(() => {
          // Wait for parent component to update rows prop
          // Check multiple times if the value has been updated before removing optimistic value
          const checkAndRemoveOptimistic = (attempts = 0) => {
            if (attempts >= 10) {
              // After 10 attempts (1 second), force remove optimistic value
              setOptimisticEditUpdates(prev => {
                const newMap = new Map(prev);
                newMap.delete(rowId);
                return newMap;
              });
              return;
            }
            
            // Check if the actual row value matches the new value
            const currentRow = rows.find(r => r.id === rowId);
            if (currentRow) {
              const currentValue = currentRow.propertyValues[propertyKey];
              
              // Compare the values (both could be objects or null)
              if (JSON.stringify(currentValue) === JSON.stringify(value)) {
                // Value has been updated, safe to remove optimistic value
                setOptimisticEditUpdates(prev => {
                  const newMap = new Map(prev);
                  newMap.delete(rowId);
                  return newMap;
                });
                return;
              }
            }
            
            // Value not updated yet, check again after a short delay
            setTimeout(() => checkAndRemoveOptimistic(attempts + 1), 100);
          };
          
          // Start checking after a short delay
          setTimeout(() => checkAndRemoveOptimistic(0), 50);
        })
        .catch((error) => {
          console.error('Failed to update media file:', error);
          setOptimisticEditUpdates(prev => {
            const newMap = new Map(prev);
            newMap.delete(rowId);
            return newMap;
          });
        })
        .finally(() => {
          setIsSaving(false);
        });
      return;
    }
    
    // Update property values
    const updatedPropertyValues: Record<string, any> = {
      ...row.propertyValues,
      [propertyKey]: value
    };
    
    // Get asset name
    const assetName = row.name || 'Untitled';

    // Apply optimistic update
    setOptimisticEditUpdates(prev => {
      const newMap = new Map(prev);
      newMap.set(rowId, {
        name: String(assetName),
        propertyValues: updatedPropertyValues
      });
      return newMap;
    });

    // Save immediately for media files
    setIsSaving(true);
    onUpdateAsset(rowId, assetName, updatedPropertyValues)
      .then(() => {
        // Wait for parent component to update rows prop
        // Check multiple times if the value has been updated before removing optimistic value
        const checkAndRemoveOptimistic = (attempts = 0) => {
          if (attempts >= 10) {
            // After 10 attempts (1 second), force remove optimistic value
            setOptimisticEditUpdates(prev => {
              const newMap = new Map(prev);
              newMap.delete(rowId);
              return newMap;
            });
            return;
          }
          
          // Check if the actual row value matches the new value
          const currentRow = rows.find(r => r.id === rowId);
          if (currentRow) {
            const currentValue = currentRow.propertyValues[propertyKey];
            
            // Compare the values (both could be objects or null)
            if (JSON.stringify(currentValue) === JSON.stringify(value)) {
              // Value has been updated, safe to remove optimistic value
              setOptimisticEditUpdates(prev => {
                const newMap = new Map(prev);
                newMap.delete(rowId);
                return newMap;
              });
              return;
            }
          }
          
          // Value not updated yet, check again after a short delay
          setTimeout(() => checkAndRemoveOptimistic(attempts + 1), 100);
        };
        
        // Start checking after a short delay
        setTimeout(() => checkAndRemoveOptimistic(0), 50);
      })
      .catch((error) => {
        console.error('Failed to update media file:', error);
        setOptimisticEditUpdates(prev => {
          const newMap = new Map(prev);
          newMap.delete(rowId);
          return newMap;
        });
      })
      .finally(() => {
        setIsSaving(false);
      });
  }, [rows, onUpdateAsset, setOptimisticEditUpdates, setIsSaving, getAllRowsForCellSelection]);

  return {
    handleMediaFileChange,
  };
}

