import { useState, useCallback } from 'react';
import { AssetRow } from '@/lib/types/libraryAssets';

export interface OptimisticUpdatesState {
  optimisticBooleanValues: Record<string, boolean>;
  optimisticEnumValues: Record<string, string>;
  setOptimisticBooleanValues: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  setOptimisticEnumValues: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}

export interface OptimisticUpdateHandlers {
  updateBooleanValue: (rowId: string, propertyKey: string, value: boolean, onSuccess: () => void, onError: () => void) => void;
  updateEnumValue: (rowId: string, propertyKey: string, value: string, onSuccess: () => void, onError: () => void) => void;
  getBooleanValue: (rowId: string, propertyKey: string, row: AssetRow) => boolean;
  getEnumValue: (rowId: string, propertyKey: string, row: AssetRow) => string | null;
  clearOptimisticValue: (rowId: string, propertyKey: string, type: 'boolean' | 'enum') => void;
}

/**
 * Hook to manage optimistic updates for boolean and enum fields
 * Provides state and handlers for immediate UI updates while waiting for server response
 */
export function useOptimisticUpdates(rows: AssetRow[]): OptimisticUpdatesState & OptimisticUpdateHandlers {
  const [optimisticBooleanValues, setOptimisticBooleanValues] = useState<Record<string, boolean>>({});
  const [optimisticEnumValues, setOptimisticEnumValues] = useState<Record<string, string>>({});

  /**
   * Update boolean value with optimistic UI update
   */
  const updateBooleanValue = useCallback((
    rowId: string,
    propertyKey: string,
    value: boolean,
    onSuccess: () => void,
    onError: () => void
  ) => {
    const optimisticKey = `${rowId}-${propertyKey}`;
    
    // Optimistic update: immediately update UI
    setOptimisticBooleanValues(prev => ({
      ...prev,
      [optimisticKey]: value
    }));

    // Wait for parent component to update rows prop
    // Check multiple times if the value has been updated before removing optimistic value
    const checkAndRemoveOptimistic = (attempts = 0) => {
      if (attempts >= 10) {
        // After 10 attempts (1 second), force remove optimistic value
        setOptimisticBooleanValues(prev => {
          if (optimisticKey in prev) {
            const next = { ...prev };
            delete next[optimisticKey];
            return next;
          }
          return prev;
        });
        onSuccess();
        return;
      }
      
      // Check if the actual row value matches the new value
      const currentRow = rows.find(r => r.id === rowId);
      if (currentRow) {
        const currentValue = currentRow.propertyValues[propertyKey];
        const currentChecked = currentValue === true || currentValue === 'true' || String(currentValue).toLowerCase() === 'true';
        
        if (currentChecked === value) {
          // Value has been updated, safe to remove optimistic value
          setOptimisticBooleanValues(prev => {
            if (optimisticKey in prev) {
              const next = { ...prev };
              delete next[optimisticKey];
              return next;
            }
            return prev;
          });
          onSuccess();
          return;
        }
      }
      
      // Value not updated yet, check again after a short delay
      setTimeout(() => checkAndRemoveOptimistic(attempts + 1), 100);
    };
    
    // Start checking after a short delay
    setTimeout(() => checkAndRemoveOptimistic(0), 50);
  }, [rows]);

  /**
   * Update enum value with optimistic UI update
   */
  const updateEnumValue = useCallback((
    rowId: string,
    propertyKey: string,
    value: string,
    onSuccess: () => void,
    onError: () => void
  ) => {
    const optimisticKey = `${rowId}-${propertyKey}`;
    
    // Optimistic update: immediately update UI
    setOptimisticEnumValues(prev => ({
      ...prev,
      [optimisticKey]: value
    }));

    // Wait for parent component to update rows prop
    const checkAndRemoveOptimistic = (attempts = 0) => {
      if (attempts >= 10) {
        // After 10 attempts (1 second), force remove optimistic value
        setOptimisticEnumValues(prev => {
          if (optimisticKey in prev) {
            const next = { ...prev };
            delete next[optimisticKey];
            return next;
          }
          return prev;
        });
        onSuccess();
        return;
      }
      
      // Check if the actual row value matches the new value
      const currentRow = rows.find(r => r.id === rowId);
      if (currentRow) {
        const currentValue = currentRow.propertyValues[propertyKey];
        
        if (String(currentValue || '') === value) {
          // Value has been updated, safe to remove optimistic value
          setOptimisticEnumValues(prev => {
            if (optimisticKey in prev) {
              const next = { ...prev };
              delete next[optimisticKey];
              return next;
            }
            return prev;
          });
          onSuccess();
          return;
        }
      }
      
      // Value not updated yet, check again after a short delay
      setTimeout(() => checkAndRemoveOptimistic(attempts + 1), 100);
    };
    
    // Start checking after a short delay
    setTimeout(() => checkAndRemoveOptimistic(0), 50);
  }, [rows]);

  /**
   * Get boolean value (optimistic or actual)
   */
  const getBooleanValue = useCallback((rowId: string, propertyKey: string, row: AssetRow): boolean => {
    const optimisticKey = `${rowId}-${propertyKey}`;
    const hasOptimisticValue = optimisticKey in optimisticBooleanValues;
    
    if (hasOptimisticValue) {
      return optimisticBooleanValues[optimisticKey];
    }
    
    const value = row.propertyValues[propertyKey];
    return value === true || value === 'true' || String(value).toLowerCase() === 'true';
  }, [optimisticBooleanValues]);

  /**
   * Get enum value (optimistic or actual)
   */
  const getEnumValue = useCallback((rowId: string, propertyKey: string, row: AssetRow): string | null => {
    const optimisticKey = `${rowId}-${propertyKey}`;
    const hasOptimisticValue = optimisticKey in optimisticEnumValues;
    
    if (hasOptimisticValue) {
      return optimisticEnumValues[optimisticKey];
    }
    
    const value = row.propertyValues[propertyKey];
    return value !== null && value !== undefined && value !== '' ? String(value) : null;
  }, [optimisticEnumValues]);

  /**
   * Clear optimistic value (for error handling)
   */
  const clearOptimisticValue = useCallback((rowId: string, propertyKey: string, type: 'boolean' | 'enum') => {
    const optimisticKey = `${rowId}-${propertyKey}`;
    
    if (type === 'boolean') {
      setOptimisticBooleanValues(prev => {
        const next = { ...prev };
        delete next[optimisticKey];
        return next;
      });
    } else {
      setOptimisticEnumValues(prev => {
        const next = { ...prev };
        delete next[optimisticKey];
        return next;
      });
    }
  }, []);

  return {
    optimisticBooleanValues,
    optimisticEnumValues,
    setOptimisticBooleanValues,
    setOptimisticEnumValues,
    updateBooleanValue,
    updateEnumValue,
    getBooleanValue,
    getEnumValue,
    clearOptimisticValue,
  };
}

