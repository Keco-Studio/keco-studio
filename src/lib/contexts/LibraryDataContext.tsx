/**
 * LibraryDataContext
 * 
 * Unified data management layer for collaborative editing across:
 * - LibraryAssetsTable (table view)
 * - AssetPage (detail view)
 * 
 * Features:
 * - Single source of truth (Yjs)
 * - Realtime synchronization (Supabase Realtime)
 * - Presence tracking
 * - Optimistic updates
 * - Conflict resolution
 */

'use client';

import React, { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef } from 'react';
import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { useSupabase } from '@/lib/SupabaseContext';
import { useAuth } from '@/lib/contexts/AuthContext';
import { getUserAvatarColor } from '@/lib/utils/avatarColors';
import { useRealtimeSubscription, type ConnectionStatus } from '@/lib/hooks/useRealtimeSubscription';
import { usePresenceTracking } from '@/lib/hooks/usePresenceTracking';
import type { AssetRow, PropertyConfig } from '@/lib/types/libraryAssets';
import type { CellUpdateEvent, AssetCreateEvent, AssetDeleteEvent, PresenceState } from '@/lib/types/collaboration';

interface LibraryDataContextValue {
  // Data access
  assets: Map<string, AssetRow>;
  getAsset: (assetId: string) => AssetRow | undefined;
  allAssets: AssetRow[]; // Ordered array (from Yjs)
  
  // Data operations
  updateAssetField: (assetId: string, fieldId: string, value: any, options?: { skipBroadcast?: boolean }) => Promise<void>;
  updateAssetName: (assetId: string, newName: string, options?: { skipBroadcast?: boolean }) => Promise<void>;
  createAsset: (name: string, propertyValues: Record<string, any>, options?: { insertAfterRowId?: string; insertBeforeRowId?: string; createdAt?: Date }) => Promise<string>;
  deleteAsset: (assetId: string) => Promise<void>;
  
  // Bulk operations
  updateMultipleFields: (updates: Array<{ assetId: string; fieldId: string; value: any }>) => Promise<void>;
  
  // Realtime collaboration
  connectionStatus: ConnectionStatus;
  
  // Presence tracking
  getUsersEditingField: (assetId: string, fieldId: string) => PresenceState[];
  setActiveField: (assetId: string | null, fieldId: string | null) => void;
  presenceUsers: PresenceState[];
  
  // Yjs access (for advanced operations)
  yDoc: Y.Doc;
  yAssets: Y.Map<Y.Map<any>>;
  
  // Loading states
  isLoading: boolean;
  isSynced: boolean;
}

const LibraryDataContext = createContext<LibraryDataContextValue | null>(null);

interface LibraryDataProviderProps {
  children: React.ReactNode;
  libraryId: string;
  projectId: string;
}

export function LibraryDataProvider({ children, libraryId, projectId }: LibraryDataProviderProps) {
  const supabase = useSupabase();
  const { userProfile } = useAuth();
  
  // Yjs setup - shared data structure
  const yDoc = useMemo(() => new Y.Doc(), [libraryId]);
  const yAssets = useMemo(() => yDoc.getMap<Y.Map<any>>('assets'), [yDoc]);
  
  // State
  const [assets, setAssets] = useState<Map<string, AssetRow>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [isSynced, setIsSynced] = useState(false);
  
  // Refs to avoid stale closures
  const assetsRef = useRef<Map<string, AssetRow>>(new Map());
  const isMountedRef = useRef(true);
  
  // Keep ref updated
  useEffect(() => {
    assetsRef.current = assets;
  }, [assets]);
  
  // IndexedDB persistence
  useEffect(() => {
    const persistence = new IndexeddbPersistence(`library-${libraryId}`, yDoc);
    
    persistence.on('synced', () => {
      setIsSynced(true);
    });
    
    return () => {
      persistence.destroy();
    };
  }, [yDoc, libraryId]);
  
  // Sync Yjs Map to React state
  useEffect(() => {
    const updateAssetsFromYjs = () => {
      const newAssets = new Map<string, AssetRow>();
      
      yAssets.forEach((yAsset, assetId) => {
        const name = yAsset.get('name') || 'Untitled';
        const yPropertyValues = yAsset.get('propertyValues');
        const createdAt = yAsset.get('created_at');
        
        // Convert Y.Map to plain object
        const propertyValues: Record<string, any> = {};
        if (yPropertyValues && typeof yPropertyValues.forEach === 'function') {
          yPropertyValues.forEach((value: any, key: string) => {
            propertyValues[key] = value;
          });
        } else if (yPropertyValues && typeof yPropertyValues === 'object') {
          // Fallback for plain objects (shouldn't happen after initialization)
          Object.assign(propertyValues, yPropertyValues);
        }
        
        newAssets.set(assetId, {
          id: assetId,
          libraryId,
          name,
          propertyValues,
          created_at: createdAt,
        });
      });
      
      
      if (isMountedRef.current) {
        setAssets(newAssets);
      } else {
      }
    };
    
    // Initial sync
    updateAssetsFromYjs();
    
    // Listen to Yjs changes (using observeDeep to catch nested Y.Map changes)
    const observer = () => {
      updateAssetsFromYjs();
    };
    
    yAssets.observeDeep(observer);
    
    return () => {
      yAssets.unobserveDeep(observer);
    };
  }, [yAssets, libraryId]);
  
  // Load initial data from database
  useEffect(() => {
    const loadInitialData = async () => {
      if (!libraryId) return;
      
      setIsLoading(true);
      
      try {
        // Load assets
        const { data: assetsData, error: assetsError } = await supabase
          .from('library_assets')
          .select('id, name, library_id, created_at')
          .eq('library_id', libraryId)
          .order('created_at', { ascending: true });
        
        if (assetsError) throw assetsError;
        
        // Load all field values for these assets
        const assetIds = assetsData?.map(a => a.id) || [];
        let valuesData: any[] = [];
        
        if (assetIds.length > 0) {
          const { data: values, error: valuesError } = await supabase
            .from('library_asset_values')
            .select('asset_id, field_id, value_json')
            .in('asset_id', assetIds);
          
          if (valuesError) throw valuesError;
          valuesData = values || [];
        }
        
        // Group values by asset
        const valuesByAsset = new Map<string, Record<string, any>>();
        valuesData.forEach((v: any) => {
          if (!valuesByAsset.has(v.asset_id)) {
            valuesByAsset.set(v.asset_id, {});
          }
          
          // Parse JSON strings for complex types
          let parsedValue = v.value_json;
          if (typeof parsedValue === 'string' && parsedValue.trim() !== '') {
            try {
              parsedValue = JSON.parse(parsedValue);
            } catch {
              // Keep original value if parsing fails
            }
          }
          
          valuesByAsset.get(v.asset_id)![v.field_id] = parsedValue;
        });
        
        // Populate Yjs with initial data (using Y.Map for propertyValues)
        yDoc.transact(() => {
          assetsData?.forEach((asset: any) => {
            const yAsset = new Y.Map();
            yAsset.set('name', asset.name);
            
            // Create Y.Map for propertyValues (nested structure)
            const yPropertyValues = new Y.Map();
            const values = valuesByAsset.get(asset.id) || {};
            Object.entries(values).forEach(([fieldId, value]) => {
              // For complex objects, use deep copy to avoid reference issues
              let valueForYjs = value;
              if (value !== null && typeof value === 'object') {
                valueForYjs = JSON.parse(JSON.stringify(value));
              }
              yPropertyValues.set(fieldId, valueForYjs);
            });
            yAsset.set('propertyValues', yPropertyValues);
            
            yAsset.set('created_at', asset.created_at);
            yAssets.set(asset.id, yAsset);
          });
        });
        
      } catch (error) {
        console.error('[LibraryDataContext] Failed to load initial data:', error);
      } finally {
        setIsLoading(false);
      }
    };
    
    loadInitialData();
  }, [libraryId, supabase, yDoc, yAssets]);
  
  // Realtime collaboration event handlers
  const handleCellUpdateEvent = useCallback((event: CellUpdateEvent) => {
    // console.log('[LibraryDataContext] handleCellUpdateEvent received:', { 
    //   assetId: event.assetId, 
    //   propertyKey: event.propertyKey, 
    //   newValue: event.newValue,
    //   newValueType: typeof event.newValue,
    //   userId: event.userId 
    // });
    
    // Update Yjs (which will trigger React state update)
    const yAsset = yAssets.get(event.assetId);
    if (!yAsset) {
      console.warn(`[LibraryDataContext] ❌ Asset ${event.assetId} not found for cell update`);
      return;
    }
    
    const yPropertyValues = yAsset.get('propertyValues') as Y.Map<any>;
    if (!yPropertyValues) {
      console.warn(`[LibraryDataContext] ❌ propertyValues not found for asset ${event.assetId}`);
      return;
    }
    
    // Only update if value actually changed to avoid unnecessary re-renders
    const currentValue = yPropertyValues.get(event.propertyKey);
    // console.log('[LibraryDataContext] Current Yjs value:', currentValue, 'currentValueType:', typeof currentValue);
    
    if (JSON.stringify(currentValue) === JSON.stringify(event.newValue)) {
      // console.log('[LibraryDataContext] Values are equal, skipping update');
      return;
    }
    
    // For complex objects (like image/file metadata), create a deep copy to ensure proper synchronization
    let valueForYjs = event.newValue;
    if (event.newValue !== null && typeof event.newValue === 'object') {
      valueForYjs = JSON.parse(JSON.stringify(event.newValue));
      // console.log('[LibraryDataContext] Created deep copy for Yjs from broadcast:', valueForYjs);
    }
    
    // Update the nested Y.Map (this will trigger observeDeep)
    yDoc.transact(() => {
      yPropertyValues.set(event.propertyKey, valueForYjs);
    });
    // console.log('[LibraryDataContext] ✅ Updated Yjs from broadcast');
  }, [yAssets, yDoc]);
  
  const handleAssetCreateEvent = useCallback((event: AssetCreateEvent) => {
    // Add new asset to Yjs (using Y.Map for propertyValues)
    const yAsset = new Y.Map();
    yAsset.set('name', event.assetName);
    
    // Create Y.Map for propertyValues
    const yPropertyValues = new Y.Map();
    Object.entries(event.propertyValues).forEach(([fieldId, value]) => {
      // For complex objects (like image/file metadata), create a deep copy
      let valueForYjs = value;
      if (value !== null && typeof value === 'object') {
        valueForYjs = JSON.parse(JSON.stringify(value));
      }
      yPropertyValues.set(fieldId, valueForYjs);
    });
    yAsset.set('propertyValues', yPropertyValues);
    
    yDoc.transact(() => {
      yAssets.set(event.assetId, yAsset);
    });
  }, [yAssets, yDoc]);
  
  const handleAssetDeleteEvent = useCallback((event: AssetDeleteEvent) => {
    // Remove asset from Yjs
    yDoc.transact(() => {
      yAssets.delete(event.assetId);
    });
  }, [yAssets, yDoc]);
  
  const handleConflictEvent = useCallback((event: CellUpdateEvent, localValue: any) => {
    // For now, remote wins (can enhance with UI later)
    console.warn('[LibraryDataContext] Conflict detected:', event);
    handleCellUpdateEvent(event);
  }, [handleCellUpdateEvent]);
  
  // Initialize realtime subscription
  const realtimeConfig = useMemo(() => {
    if (!userProfile || !libraryId) {
      return null;
    }
    
    return {
      libraryId,
      currentUserId: userProfile.id,
      currentUserName: userProfile.username || userProfile.full_name || userProfile.email,
      currentUserEmail: userProfile.email,
      avatarColor: getUserAvatarColor(userProfile.id),
      onCellUpdate: handleCellUpdateEvent,
      onAssetCreate: handleAssetCreateEvent,
      onAssetDelete: handleAssetDeleteEvent,
      onConflict: handleConflictEvent,
    };
  }, [libraryId, userProfile, handleCellUpdateEvent, handleAssetCreateEvent, handleAssetDeleteEvent, handleConflictEvent]);
  
  const realtimeSubscription = useRealtimeSubscription(
    realtimeConfig || {
      libraryId: '',
      currentUserId: '',
      currentUserName: '',
      currentUserEmail: '',
      avatarColor: '',
      onCellUpdate: () => {},
      onAssetCreate: () => {},
      onAssetDelete: () => {},
      onConflict: () => {},
    }
  );
  
  const { connectionStatus, broadcastCellUpdate, broadcastAssetCreate, broadcastAssetDelete } = 
    realtimeConfig ? realtimeSubscription : {
      connectionStatus: 'disconnected' as const,
      broadcastCellUpdate: async () => {},
      broadcastAssetCreate: async () => {},
      broadcastAssetDelete: async () => {},
    };
  
  // Presence tracking - use useMemo to avoid recreating config on every render
  const presenceConfig = useMemo(() => ({
    libraryId: libraryId || '',
    userId: userProfile?.id || '',
    userName: userProfile?.username || userProfile?.full_name || userProfile?.email || 'Anonymous',
    userEmail: userProfile?.email || '',
    avatarColor: userProfile ? getUserAvatarColor(userProfile.id) : '#999999',
    debugLabel: 'LibraryData',
  }), [libraryId, userProfile]);
  
  const presenceTracking = usePresenceTracking(presenceConfig);
  
  // Data operations
  const updateAssetField = useCallback(async (
    assetId: string,
    fieldId: string,
    value: any,
    options?: { skipBroadcast?: boolean }
  ) => {
    // console.log('[LibraryDataContext] updateAssetField called:', { assetId, fieldId, value, valueType: typeof value });
    
    // 1. Optimistic update in Yjs
    const yAsset = yAssets.get(assetId);
    if (!yAsset) {
      throw new Error(`Asset ${assetId} not found`);
    }
    
    const yPropertyValues = yAsset.get('propertyValues') as Y.Map<any>;
    if (!yPropertyValues) {
      throw new Error(`propertyValues not found for asset ${assetId}`);
    }
    
    const oldValue = yPropertyValues.get(fieldId);
    // console.log('[LibraryDataContext] oldValue:', oldValue, 'oldValueType:', typeof oldValue);
    
    // For complex objects (like image/file metadata), create a deep copy to avoid reference issues
    // This ensures proper synchronization across clients
    let valueForYjs = value;
    if (value !== null && typeof value === 'object') {
      // Deep clone the object to break any references
      valueForYjs = JSON.parse(JSON.stringify(value));
      // console.log('[LibraryDataContext] Created deep copy for Yjs:', valueForYjs);
    }
    
    // Update the nested Y.Map (this will trigger observeDeep)
    yDoc.transact(() => {
      yPropertyValues.set(fieldId, valueForYjs);
    });
    // console.log('[LibraryDataContext] ✅ Updated Yjs');
    
    // 2. Save to database
    try {
      // Supabase jsonb column can handle objects directly, no need to stringify
      // console.log('[LibraryDataContext] Saving to database...', { asset_id: assetId, field_id: fieldId, value_json: value });
      const { data, error } = await supabase
        .from('library_asset_values')
        .upsert({
          asset_id: assetId,
          field_id: fieldId,
          value_json: value, // Pass the original value, Supabase handles serialization
        }, {
          onConflict: 'asset_id,field_id',
        })
        .select(); // Add select to get the saved data
      
      if (error) throw error;
      // console.log('[LibraryDataContext] ✅ Database save successful, returned data:', data);
        
      // 3. Broadcast update (unless explicitly skipped)
      // Add a small delay to ensure database transaction is fully committed
      // This is especially important for INSERT operations (null -> object transitions)
      if (!options?.skipBroadcast && realtimeConfig) {
        // console.log('[LibraryDataContext] Broadcasting update...');
        // Wait 100ms to ensure database transaction is committed
        await new Promise(resolve => setTimeout(resolve, 100));
        await broadcastCellUpdate(assetId, fieldId, valueForYjs, oldValue);
        // console.log('[LibraryDataContext] ✅ Broadcast complete');
      }
    } catch (error) {
      console.error('[LibraryDataContext] ❌ Error in updateAssetField:', error);
      // Revert optimistic update on error
      yDoc.transact(() => {
        yPropertyValues.set(fieldId, oldValue);
      });
      throw error;
    }
  }, [yAssets, yDoc, supabase, broadcastCellUpdate, realtimeConfig]);
  
  const updateAssetName = useCallback(async (
    assetId: string,
    newName: string,
    options?: { skipBroadcast?: boolean }
  ) => {
    // 1. Optimistic update in Yjs
    const yAsset = yAssets.get(assetId);
    if (!yAsset) {
      throw new Error(`Asset ${assetId} not found`);
    }
    
    const oldName = yAsset.get('name');
    
    yDoc.transact(() => {
      yAsset.set('name', newName);
    });
    
    // 2. Save to database
    try {
      const { error } = await supabase
        .from('library_assets')
        .update({ name: newName })
        .eq('id', assetId);
      
      if (error) throw error;
      
      // 3. Broadcast as field update (name is a special field)
      if (!options?.skipBroadcast && realtimeConfig) {
        await broadcastCellUpdate(assetId, 'name', newName, oldName);
      }
    } catch (error) {
      // Revert optimistic update on error
      yDoc.transact(() => {
        yAsset.set('name', oldName);
      });
      throw error;
    }
  }, [yAssets, yDoc, supabase, broadcastCellUpdate, realtimeConfig]);
  
  const createAsset = useCallback(async (
    name: string,
    propertyValues: Record<string, any>,
    options?: { insertAfterRowId?: string; insertBeforeRowId?: string; createdAt?: Date }
  ): Promise<string> => {
    // 1. Create in database
    const { data: newAsset, error: assetError } = await supabase
      .from('library_assets')
      .insert({
        library_id: libraryId,
        name,
        created_at: options?.createdAt?.toISOString(),
      })
      .select()
      .single();
    
    if (assetError) throw assetError;
    
    const assetId = newAsset.id;
    
    // 2. Insert field values
    const fieldValues = Object.entries(propertyValues).map(([fieldId, value]) => ({
      asset_id: assetId,
      field_id: fieldId,
      value_json: value,
    }));
    
    if (fieldValues.length > 0) {
      const { error: valuesError } = await supabase
        .from('library_asset_values')
        .insert(fieldValues);
      
      if (valuesError) throw valuesError;
    }
    
    // 3. Add to Yjs (using Y.Map for propertyValues)
    const yAsset = new Y.Map();
    yAsset.set('name', name);
    
    // Create Y.Map for propertyValues
    const yPropertyValues = new Y.Map();
    Object.entries(propertyValues).forEach(([fieldId, value]) => {
      // For complex objects, use deep copy to avoid reference issues
      let valueForYjs = value;
      if (value !== null && typeof value === 'object') {
        valueForYjs = JSON.parse(JSON.stringify(value));
      }
      yPropertyValues.set(fieldId, valueForYjs);
    });
    yAsset.set('propertyValues', yPropertyValues);
    
    yAsset.set('created_at', newAsset.created_at);
    
    yDoc.transact(() => {
      yAssets.set(assetId, yAsset);
    });
    
    // 4. Broadcast creation
    if (realtimeConfig) {
      await broadcastAssetCreate(assetId, name, propertyValues, {
        insertAfterRowId: options?.insertAfterRowId,
        insertBeforeRowId: options?.insertBeforeRowId,
        targetCreatedAt: options?.createdAt?.toISOString(),
      });
    }
    
    return assetId;
  }, [libraryId, supabase, yDoc, yAssets, broadcastAssetCreate, realtimeConfig]);
  
  const deleteAsset = useCallback(async (assetId: string) => {
    const asset = assetsRef.current.get(assetId);
    if (!asset) {
      throw new Error(`Asset ${assetId} not found`);
    }
    
    // 1. Delete from database
    const { error } = await supabase
      .from('library_assets')
      .delete()
      .eq('id', assetId);
    
    if (error) throw error;
    
    // 2. Remove from Yjs
    yDoc.transact(() => {
      yAssets.delete(assetId);
    });
    
    // 3. Broadcast deletion
    if (realtimeConfig) {
      await broadcastAssetDelete(assetId, asset.name);
    }
  }, [supabase, yDoc, yAssets, broadcastAssetDelete, realtimeConfig]);
  
  const updateMultipleFields = useCallback(async (
    updates: Array<{ assetId: string; fieldId: string; value: any }>
  ) => {
    // Batch update - useful for paste operations
    const promises = updates.map(({ assetId, fieldId, value }) =>
      updateAssetField(assetId, fieldId, value, { skipBroadcast: true })
    );
    
    await Promise.all(promises);
    
    // Broadcast all updates after they're saved
    if (realtimeConfig) {
      for (const { assetId, fieldId, value } of updates) {
        await broadcastCellUpdate(assetId, fieldId, value);
      }
    }
  }, [updateAssetField, broadcastCellUpdate, realtimeConfig]);
  
  // Helper functions
  const getAsset = useCallback((assetId: string) => {
    return assetsRef.current.get(assetId);
  }, []);
  
  const getUsersEditingField = useCallback((assetId: string, fieldId: string) => {
    return presenceTracking.getUsersEditingCell(assetId, fieldId);
  }, [presenceTracking]);
  
  const setActiveField = useCallback((assetId: string | null, fieldId: string | null) => {
    presenceTracking.updateActiveCell(assetId, fieldId);
  }, [presenceTracking]);
  
  // Convert Map to ordered array (maintain Yjs order)
  const allAssets = useMemo(() => {
    return Array.from(assets.values()).sort((a, b) => {
      // Sort by created_at if available
      if (a.created_at && b.created_at) {
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      }
      return 0;
    });
  }, [assets]);
  
  // Cleanup
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);
  
  const contextValue: LibraryDataContextValue = {
    assets,
    getAsset,
    allAssets,
    updateAssetField,
    updateAssetName,
    createAsset,
    deleteAsset,
    updateMultipleFields,
    connectionStatus,
    getUsersEditingField,
    setActiveField,
    presenceUsers: presenceTracking.presenceUsers || [],
    yDoc,
    yAssets,
    isLoading,
    isSynced,
  };
  
  return (
    <LibraryDataContext.Provider value={contextValue}>
      {children}
    </LibraryDataContext.Provider>
  );
}

export function useLibraryData() {
  const context = useContext(LibraryDataContext);
  if (!context) {
    throw new Error('useLibraryData must be used within LibraryDataProvider');
  }
  return context;
}

