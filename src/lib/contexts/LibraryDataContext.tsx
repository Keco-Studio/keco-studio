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
import type { CellUpdateEvent, AssetCreateEvent, AssetDeleteEvent, PresenceState, CellsBatchUpdateEvent } from '@/lib/types/collaboration';
import { serializeError } from '@/lib/utils/errorUtils';
import { getLibraryAssetsWithProperties } from '@/lib/services/libraryAssetsService';

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
  /** 批量更新并一次性广播，用于 Clear Content，效仿 Delete Row 的即时同步 */
  updateAssetsBatch: (updates: Array<{ assetId: string; assetName: string; propertyValues: Record<string, any> }>) => Promise<void>;
  
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
  
  // Sync Yjs Map to React state
  useEffect(() => {
    const updateAssetsFromYjs = () => {
      const newAssets = new Map<string, AssetRow>();
      
      yAssets.forEach((yAsset, assetId) => {
        const name = yAsset.get('name') || 'Untitled';
        const yPropertyValues = yAsset.get('propertyValues');
        const createdAt = yAsset.get('created_at');
        const rowIndex = yAsset.get('row_index');
        
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
          rowIndex: typeof rowIndex === 'number' ? rowIndex : undefined,
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
  
  // Load initial data from database (can be reused after restore)
  const loadInitialData = useCallback(async () => {
    if (!libraryId) return;
    
    setIsLoading(true);
    
    try {
      // 使用与版本快照完全一致的服务读取当前库数据，避免「当前视图」和「版本快照」两套取数逻辑
      const assetRows: AssetRow[] = await getLibraryAssetsWithProperties(supabase, libraryId);

      // Populate Yjs with data (using Y.Map for propertyValues)
      // Always clear existing Yjs state first to avoid mixing old and new data
      yDoc.transact(() => {
        yAssets.clear();
        
        assetRows.forEach((asset: AssetRow) => {
          const yAsset = new Y.Map();
          yAsset.set('name', asset.name);
          
          // Create Y.Map for propertyValues (nested structure)
          const yPropertyValues = new Y.Map();
          const values = asset.propertyValues || {};
          Object.entries(values).forEach(([fieldId, value]) => {
            // For complex objects, use deep copy to avoid reference issues
            let valueForYjs = value;
            if (value !== null && typeof value === 'object') {
              valueForYjs = JSON.parse(JSON.stringify(value));
            }
            yPropertyValues.set(fieldId, valueForYjs);
          });
          yAsset.set('propertyValues', yPropertyValues);
          
          if (asset.created_at) yAsset.set('created_at', asset.created_at);
          if (typeof asset.rowIndex === 'number') yAsset.set('row_index', asset.rowIndex);
          yAssets.set(asset.id, yAsset as any);
        });
      });
      
    } catch (error) {
      console.error('[LibraryDataContext] Failed to load initial data:', error);
    } finally {
      setIsLoading(false);
    }
  }, [libraryId, supabase, yDoc, yAssets]);

  // Restore 后直接用 snapshot 覆盖 Yjs，保证「当前视图 = 刚恢复的版本」，与创建版本用 Yjs 一致
  const applySnapshotToYjs = useCallback((snapshotData: { assets?: Array<{ id: string; name?: string; propertyValues?: Record<string, any>; createdAt?: string; rowIndex?: number | null }> }) => {
    if (!snapshotData?.assets || !Array.isArray(snapshotData.assets)) return;
    yDoc.transact(() => {
      yAssets.clear();
      snapshotData.assets.forEach((asset: any) => {
        const yAsset = new Y.Map();
        yAsset.set('name', asset.name ?? 'Untitled');
        const yPropertyValues = new Y.Map();
        const values = asset.propertyValues ?? {};
        Object.entries(values).forEach(([fieldId, value]) => {
          let valueForYjs = value;
          if (value !== null && typeof value === 'object') {
            valueForYjs = JSON.parse(JSON.stringify(value));
          }
          yPropertyValues.set(fieldId, valueForYjs);
        });
        yAsset.set('propertyValues', yPropertyValues);
        if (asset.createdAt) yAsset.set('created_at', asset.createdAt);
        if (typeof asset.rowIndex === 'number') yAsset.set('row_index', asset.rowIndex);
        yAssets.set(asset.id, yAsset as any);
      });
    });
  }, [yDoc, yAssets]);

  // Initial load
  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  // IndexedDB persistence — after restore, overwrite with DB so collaborative view matches server (fixes 44 vs 28 row mismatch)
  useEffect(() => {
    const persistence = new IndexeddbPersistence(`library-${libraryId}`, yDoc);
    persistence.on('synced', () => {
      setIsSynced(true);
      loadInitialData();
    });
    return () => {
      persistence.destroy();
    };
  }, [yDoc, libraryId, loadInitialData]);

  // Reload data when a library restore event is dispatched
  // 若带 snapshotData 则直接用其覆盖 Yjs，保证当前视图 = 刚恢复的版本；否则从 DB 拉取
  useEffect(() => {
    const handleLibraryRestored = (event: Event) => {
      const customEvent = event as CustomEvent<{ libraryId: string; snapshotData?: any }>;
      if (customEvent.detail?.libraryId !== libraryId) return;
      if (customEvent.detail?.snapshotData) {
        applySnapshotToYjs(customEvent.detail.snapshotData);
      } else {
        loadInitialData();
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('libraryRestored', handleLibraryRestored as EventListener);
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('libraryRestored', handleLibraryRestored as EventListener);
      }
    };
  }, [libraryId, loadInitialData, applySnapshotToYjs]);

  // Realtime: 当有人成功 restore 一个版本时，所有协作者自动从 DB 重新加载一次
  useEffect(() => {
    if (!libraryId) return;

    const channel = supabase
      .channel(`library-versions-restore:${libraryId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'library_versions',
          filter: `library_id=eq.${libraryId}`,
        },
        (payload) => {
          try {
            const row: any = payload.new;
            if (row?.version_type === 'restore') {
              // 有新 restore 版本记录插入，说明库已被回滚到某个快照 → 强制用 DB 覆盖本地 Yjs
              loadInitialData();
            }
          } catch (err) {
            console.error('[LibraryDataContext] Failed to handle restore realtime event', err);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [libraryId, supabase, loadInitialData]);
  
  // Batch queue for cell updates - apply in one transact so UI updates at once (fixes "one by one" disappearing)
  const cellUpdateQueueRef = useRef<CellUpdateEvent[]>([]);
  const cellUpdateFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  const flushCellUpdateQueue = useCallback(() => {
    const events = cellUpdateQueueRef.current;
    cellUpdateQueueRef.current = [];
    if (events.length === 0) return;
    
    yDoc.transact(() => {
      for (const event of events) {
        const yAsset = yAssets.get(event.assetId);
        if (!yAsset) continue;
        const yPropertyValues = yAsset.get('propertyValues') as Y.Map<any>;
        if (!yPropertyValues) continue;
        const currentValue = yPropertyValues.get(event.propertyKey);
        if (JSON.stringify(currentValue) === JSON.stringify(event.newValue)) continue;
        
        let valueForYjs = event.newValue;
        if (event.newValue !== null && typeof event.newValue === 'object') {
          valueForYjs = JSON.parse(JSON.stringify(event.newValue));
        }
        yPropertyValues.set(event.propertyKey, valueForYjs);
        if (event.propertyKey === 'name') {
          yAsset.set('name', valueForYjs ?? '');
        }
      }
    });
  }, [yAssets, yDoc]);
  
  // Realtime collaboration event handlers
  // 队列里已有多个事件时用较长延迟收集更多，协作者端多条 postgres 更新会合并成一次应用，与操作者「一次性消失」一致
  const handleCellUpdateEvent = useCallback((event: CellUpdateEvent) => {
    cellUpdateQueueRef.current.push(event);
    if (cellUpdateFlushTimerRef.current) clearTimeout(cellUpdateFlushTimerRef.current);
    const delay = cellUpdateQueueRef.current.length > 1 ? 50 : 16;
    cellUpdateFlushTimerRef.current = setTimeout(() => {
      cellUpdateFlushTimerRef.current = null;
      flushCellUpdateQueue();
    }, delay);
  }, [flushCellUpdateQueue]);
  
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
    // Ensure created_at so allAssets sort is consistent across clients (fixes row order mismatch)
    const createdAt =
      event.targetCreatedAt ||
      (event.timestamp ? new Date(event.timestamp).toISOString() : new Date().toISOString());
    yAsset.set('created_at', createdAt);
    
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

  // 行序变更事件：统一触发一次从 DB 的 reload，以后如果有更细粒度的行序事件再优化为局部更新
  const handleRowOrderChangeEvent = useCallback(() => {
    loadInitialData();
  }, [loadInitialData]);

  // 批量单元格更新：Clear Content 等场景，一次接收所有变更并应用到 Yjs
  const handleCellsBatchUpdateEvent = useCallback((event: CellsBatchUpdateEvent) => {
    if (event.cells.length === 0) return;
    yDoc.transact(() => {
      for (const { assetId, propertyKey, newValue } of event.cells) {
        const yAsset = yAssets.get(assetId);
        if (!yAsset) continue;
        let valueForYjs = newValue;
        if (typeof newValue === 'number' && Number.isNaN(newValue)) {
          valueForYjs = null;
        } else if (newValue !== null && typeof newValue === 'object') {
          valueForYjs = JSON.parse(JSON.stringify(newValue));
        }
        if (propertyKey === 'name') {
          yAsset.set('name', valueForYjs ?? '');
        } else {
          const yPropertyValues = yAsset.get('propertyValues') as Y.Map<any>;
          if (yPropertyValues) {
            yPropertyValues.set(propertyKey, valueForYjs);
          }
        }
      }
    });
  }, [yAssets, yDoc]);
  
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
      onRowOrderChange: handleRowOrderChangeEvent,
      onCellsBatchUpdate: handleCellsBatchUpdateEvent,
    };
  }, [libraryId, userProfile, handleCellUpdateEvent, handleAssetCreateEvent, handleAssetDeleteEvent, handleConflictEvent, handleRowOrderChangeEvent, handleCellsBatchUpdateEvent]);
  
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
      onRowOrderChange: () => {},
      onCellsBatchUpdate: () => {},
    }
  );
  
  const { connectionStatus, broadcastCellUpdate, broadcastAssetCreate, broadcastAssetDelete, broadcastCellsBatchUpdate, broadcastRowOrderChange } = 
    realtimeConfig ? realtimeSubscription : {
      connectionStatus: 'disconnected' as const,
      broadcastCellUpdate: async () => {},
      broadcastAssetCreate: async () => {},
      broadcastAssetDelete: async () => {},
      broadcastCellsBatchUpdate: async () => {},
      broadcastRowOrderChange: async () => {},
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
    
    // Normalize NaN to null so it never persists (avoids "NaN" in table after Clear Content etc.)
    let valueForYjs = value;
    if (typeof value === 'number' && Number.isNaN(value)) {
      valueForYjs = null;
    } else if (value !== null && typeof value === 'object') {
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
      const errMsg = serializeError(error);
      console.error(
        `[LibraryDataContext] ❌ Error in updateAssetField: assetId=${assetId} fieldId=${fieldId} | ${errMsg}`
      );
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
    options?: { insertAfterRowId?: string; insertBeforeRowId?: string; createdAt?: Date; rowIndex?: number }
  ): Promise<string> => {
    // 0. Determine rowIndex: prefer explicit option, otherwise append to end
    let nextRowIndex: number;
    if (typeof options?.rowIndex === 'number') {
      nextRowIndex = options.rowIndex;
    } else {
      const current = Array.from(assetsRef.current.values());
      const maxIdx = current.reduce(
        (max, a) => (typeof a.rowIndex === 'number' && a.rowIndex > max ? a.rowIndex : max),
        0
      );
      nextRowIndex = maxIdx + 1;
    }

    // 1. Create in database
    const { data: newAsset, error: assetError } = await supabase
      .from('library_assets')
      .insert({
        library_id: libraryId,
        name,
        created_at: options?.createdAt?.toISOString(),
        row_index: nextRowIndex,
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
    // 对于纯追加（没有显式 rowIndex）的场景，可以直接在本地插入 Yjs 记录，立即看到新行。
    // 对于带 rowIndex 的场景（Add Row / Insert Above/Below / Paste 新行），我们后面会通过 loadInitialData()
    // 用 DB 的完整行序覆盖一次本地状态，这里就不再做本地乐观插入，避免出现「先出现在错误位置再跳动」的闪烁。
    if (typeof options?.rowIndex !== 'number') {
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
      // Ensure created_at / row_index so allAssets sort puts insert-above/insert-below in correct position
      yAsset.set('created_at', newAsset.created_at ?? options?.createdAt?.toISOString() ?? new Date().toISOString());
      yAsset.set('row_index', newAsset.row_index ?? nextRowIndex);

      yDoc.transact(() => {
        yAssets.set(assetId, yAsset);
      });
    }

    // 如果这次创建显式使用了 rowIndex（包括追加、Insert Above/Below、Paste 新行），
    // 先在本客户端用 DB 结果全量刷新一次，避免本地仍持有旧的 rowIndex 造成“自己这边行出现在末尾”的错觉。
    if (typeof options?.rowIndex === 'number') {
      await loadInitialData();
    }
    
    // 4. Broadcast creation
    if (realtimeConfig) {
      await broadcastAssetCreate(assetId, name, propertyValues, {
        insertAfterRowId: options?.insertAfterRowId,
        insertBeforeRowId: options?.insertBeforeRowId,
        targetCreatedAt: options?.createdAt?.toISOString(),
      });
      // 如果显式指定了 rowIndex，说明这次创建可能影响到行顺序（包括追加、上下插入、Paste 新行），
      // 通过单独的 roworder:change 事件提醒所有客户端（包括发起者）用最新的 DB 行序刷新视图。
      if (typeof options?.rowIndex === 'number') {
        await broadcastRowOrderChange();
      }
    }
    
    return assetId;
  }, [libraryId, supabase, yDoc, yAssets, broadcastAssetCreate, broadcastRowOrderChange, realtimeConfig, loadInitialData]);
  
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

  /** 批量更新并一次性广播，用于 Clear Content，效仿 Delete Row 的即时同步 */
  const updateAssetsBatch = useCallback(async (
    updates: Array<{ assetId: string; assetName: string; propertyValues: Record<string, any> }>
  ) => {
    const cellsToBroadcast: Array<{ assetId: string; propertyKey: string; newValue: any }> = [];

    for (const { assetId, assetName, propertyValues } of updates) {
      const asset = assetsRef.current.get(assetId);
      if (!asset) continue;

      if (asset.name !== assetName) {
        await updateAssetName(assetId, assetName, { skipBroadcast: true });
        cellsToBroadcast.push({ assetId, propertyKey: 'name', newValue: assetName });
      }

      for (const [fieldId, value] of Object.entries(propertyValues)) {
        const oldValue = asset.propertyValues[fieldId];
        if (JSON.stringify(oldValue) === JSON.stringify(value)) continue;
        await updateAssetField(assetId, fieldId, value, { skipBroadcast: true });
        cellsToBroadcast.push({ assetId, propertyKey: fieldId, newValue: value });
      }
    }

    if (realtimeConfig && cellsToBroadcast.length > 0) {
      await broadcastCellsBatchUpdate(cellsToBroadcast);
    }
  }, [updateAssetName, updateAssetField, broadcastCellsBatchUpdate, realtimeConfig]);
  
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
  
  // Convert Map to ordered array (sort by rowIndex then id for deterministic order across clients)
  const allAssets = useMemo(() => {
    return Array.from(assets.values()).sort((a, b) => {
      // Prefer explicit rowIndex when available
      if (typeof a.rowIndex === 'number' && typeof b.rowIndex === 'number') {
        if (a.rowIndex !== b.rowIndex) return a.rowIndex - b.rowIndex;
      } else if (typeof a.rowIndex === 'number') {
        return -1;
      } else if (typeof b.rowIndex === 'number') {
        return 1;
      }

      // Fallback: created_at + id to keep previous behavior for older data
      if (!a.created_at && !b.created_at) return a.id.localeCompare(b.id);
      if (!a.created_at) return 1;
      if (!b.created_at) return -1;
      const timeDiff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      return timeDiff !== 0 ? timeDiff : a.id.localeCompare(b.id);
    });
  }, [assets]);
  
  // Cleanup
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (cellUpdateFlushTimerRef.current) {
        clearTimeout(cellUpdateFlushTimerRef.current);
        cellUpdateFlushTimerRef.current = null;
      }
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
    updateAssetsBatch,
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

