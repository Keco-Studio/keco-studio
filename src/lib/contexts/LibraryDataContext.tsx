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
import { useSupabase } from '@/lib/SupabaseContext';
import { useAuth } from '@/lib/contexts/AuthContext';
import { getUserAvatarColor } from '@/lib/utils/avatarColors';
import { useRealtimeSubscription, type ConnectionStatus } from '@/lib/hooks/useRealtimeSubscription';
import { usePresenceTracking } from '@/lib/hooks/usePresenceTracking';
import type { AssetRow, PropertyConfig } from '@/lib/types/libraryAssets';
import type { PresenceState } from '@/lib/types/collaboration';
import { getLibraryAssetsWithProperties } from '@/lib/services/libraryAssetsService';
import { compareAssetsForUiRow } from '@/lib/utils/assetEmptiness';
import { createFormulaFieldMetaCache } from '@/lib/library/formulaFieldMetaCache';
import {
  applyReferenceSyncToLocalState,
  syncReferencesAfterSourceChange,
} from '@/lib/library/referenceSync';
import {
  hydrateYAssetsFromRows,
  hydrateYAssetsFromSnapshot,
  type LibrarySnapshotData,
} from '@/lib/library/yjsAssetHydration';
import { runLatestLibraryHydration } from '@/lib/library/loadInitialLibraryData';
import { useLibraryAssetMutations } from '@/components/libraries/hooks/useLibraryAssetMutations';
import { useLibraryRealtimeHandlers } from '@/components/libraries/hooks/useLibraryRealtimeHandlers';
import { useQueryClient } from '@tanstack/react-query';
import { invalidateLibraryAssetsData } from '@/lib/queryInvalidation';

interface LibraryDataContextValue {
  // Data access
  assets: Map<string, AssetRow>;
  getAsset: (assetId: string) => AssetRow | undefined;
  allAssets: AssetRow[]; // Ordered array (from Yjs)

  // Data operations
  updateAssetField: (assetId: string, fieldId: string, value: any, options?: { skipBroadcast?: boolean }) => Promise<void>;
  updateAssetName: (assetId: string, newName: string, options?: { skipBroadcast?: boolean }) => Promise<void>;
  createAsset: (name: string, propertyValues: Record<string, any>, options?: { insertAfterRowId?: string; insertBeforeRowId?: string; createdAt?: Date; rowIndex?: number; skipReload?: boolean }) => Promise<string>;
  deleteAsset: (assetId: string) => Promise<void>;
  refreshAssetsFromServer: () => Promise<void>;
  applySnapshot: (snapshotData: LibrarySnapshotData) => void;
  invalidateFormulaFieldMeta: () => void;

  // Bulk operations
  updateMultipleFields: (updates: Array<{ assetId: string; fieldId: string; value: any }>) => Promise<void>;
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

type FormulaFieldMetaRow = {
  id: string;
  label: string;
  data_type: string;
  formula_expression: string | null;
};

export function LibraryDataProvider({ children, libraryId, projectId }: LibraryDataProviderProps) {
  const supabase = useSupabase();
  const queryClient = useQueryClient();
  const { userProfile, isAuthenticated, isLoading: isAuthLoading } = useAuth();

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
  const loadInitialDataGenerationRef = useRef(0);
  // Track asset IDs created during a batch insert (skipReload=true) so that
  // postgres_changes INSERT events don't add them to yAssets with missing row_index.
  const pendingBatchInsertIdsRef = useRef<Set<string>>(new Set());

  const formulaFieldMetaCache = useMemo(
    () =>
      createFormulaFieldMetaCache<FormulaFieldMetaRow>(async (targetLibraryId) => {
        const { data, error } = await supabase
          .from('library_field_definitions')
          .select('id, label, data_type, formula_expression')
          .eq('library_id', targetLibraryId);

        if (error) throw error;
        return (data ?? []) as FormulaFieldMetaRow[];
      }),
    [supabase]
  );

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
    if (!libraryId || !isAuthenticated || !userProfile) return;

    await runLatestLibraryHydration({
      generationRef: loadInitialDataGenerationRef,
      isMounted: () => isMountedRef.current,
      // Use the same service as version snapshots so the current view and
      // saved snapshots read the same row shape.
      fetchAssetRows: () => getLibraryAssetsWithProperties(supabase, libraryId),
      hydrate: (assetRows) => hydrateYAssetsFromRows(yDoc, yAssets, assetRows),
      setIsLoading,
      setIsSynced,
      onError: (error) => {
        console.error('[LibraryDataContext] Failed to load initial data:', error);
      },
    });
  }, [libraryId, isAuthenticated, userProfile, supabase, yDoc, yAssets]);

  const invalidateFormulaFieldMeta = useCallback(() => {
    formulaFieldMetaCache.invalidate(libraryId);
  }, [formulaFieldMetaCache, libraryId]);

  // After restore, apply the snapshot directly so the current view matches
  // the restored version before the next server refresh arrives.
  const applySnapshotToYjs = useCallback((snapshotData: LibrarySnapshotData) => {
    hydrateYAssetsFromSnapshot(yDoc, yAssets, snapshotData);
  }, [yDoc, yAssets]);

  // Initial load (wait for auth so RLS-backed queries have a valid session)
  useEffect(() => {
    if (isAuthLoading || !isAuthenticated || !userProfile) return;
    loadInitialData();
  }, [loadInitialData, isAuthLoading, isAuthenticated, userProfile]);

  // Realtime restore events cause collaborators to reload from the server.
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
              // A restore version means the library was rolled back to a snapshot.
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

  useEffect(() => {
    formulaFieldMetaCache.clear();
  }, [formulaFieldMetaCache, libraryId]);

  const getFormulaFieldMeta = useCallback(async (): Promise<FormulaFieldMetaRow[]> => {
    return formulaFieldMetaCache.get(libraryId);
  }, [formulaFieldMetaCache, libraryId]);

  const {
    handleCellUpdateEvent,
    handleAssetCreateEvent,
    handleAssetDeleteEvent,
    handleConflictEvent,
    handleRowOrderChangeEvent,
    handleCellsBatchUpdateEvent,
  } = useLibraryRealtimeHandlers({
    yDoc,
    yAssets,
    loadInitialData,
    pendingBatchInsertIdsRef,
  });

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
      onReconnect: loadInitialData,
    };
  }, [libraryId, userProfile, handleCellUpdateEvent, handleAssetCreateEvent, handleAssetDeleteEvent, handleConflictEvent, handleRowOrderChangeEvent, handleCellsBatchUpdateEvent, loadInitialData]);

  const realtimeSubscription = useRealtimeSubscription(
    realtimeConfig || {
      libraryId: '',
      currentUserId: '',
      currentUserName: '',
      currentUserEmail: '',
      avatarColor: '',
      onCellUpdate: () => { },
      onAssetCreate: () => { },
      onAssetDelete: () => { },
      onConflict: () => { },
      onRowOrderChange: () => { },
      onCellsBatchUpdate: () => { },
      onReconnect: () => { },
    }
  );

  const { connectionStatus, broadcastCellUpdate, broadcastAssetCreate, broadcastAssetDelete, broadcastCellsBatchUpdate, broadcastRowOrderChange } =
    realtimeConfig ? realtimeSubscription : {
      connectionStatus: 'disconnected' as const,
      broadcastCellUpdate: async () => { },
      broadcastAssetCreate: async () => { },
      broadcastAssetDelete: async () => { },
      broadcastCellsBatchUpdate: async () => { },
      broadcastRowOrderChange: async () => { },
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

  const applyReferenceSync = useCallback(
    (refUpdates: Parameters<typeof applyReferenceSyncToLocalState>[0]['refUpdates']) => {
      applyReferenceSyncToLocalState({
        refUpdates,
        libraryId,
        yDoc,
        yAssets,
        queryClient,
        loadInitialData,
      });
    },
    [libraryId, loadInitialData, queryClient, yDoc, yAssets]
  );

  const syncReferenceChange = useCallback(
    async (assetId: string, fieldId: string, valueJson: unknown) => {
      await syncReferencesAfterSourceChange({
        supabase,
        queryClient,
        libraryId,
        yDoc,
        yAssets,
        loadInitialData,
        assetId,
        fieldId,
        valueJson,
      });
    },
    [libraryId, loadInitialData, queryClient, supabase, yDoc, yAssets]
  );

  const {
    updateAssetField,
    updateAssetName,
    createAsset,
    deleteAsset,
    updateMultipleFields,
    updateAssetsBatch,
  } = useLibraryAssetMutations({
    supabase,
    queryClient,
    libraryId,
    projectId,
    yDoc,
    yAssets,
    assetsRef,
    pendingBatchInsertIdsRef,
    getFormulaFieldMeta,
    loadInitialData,
    realtimeConfig,
    realtime: {
      broadcastCellUpdate,
      broadcastAssetCreate,
      broadcastAssetDelete,
      broadcastCellsBatchUpdate,
      broadcastRowOrderChange,
    },
  });

  const refreshAssetsFromServer = useCallback(async () => {
    await loadInitialData();
    await invalidateLibraryAssetsData(queryClient, { libraryId, refetchActiveAssets: true });
  }, [libraryId, loadInitialData, queryClient]);

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

  // Convert Map to ordered array (sort by rowIndex then created_at/id — matches table row numbers)
  const orderedAssetsRef = useRef<AssetRow[]>([]);
  const allAssets = useMemo(() => {
    const nextAssets = Array.from(assets.values());
    const previousAssets = orderedAssetsRef.current;
    const orderIsUnchanged =
      nextAssets.length === previousAssets.length &&
      nextAssets.every((asset, index) => asset.id === previousAssets[index]?.id);
    const orderedAssets = orderIsUnchanged
      ? nextAssets
      : nextAssets.sort(compareAssetsForUiRow);
    orderedAssetsRef.current = orderedAssets;
    return orderedAssets;
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
    refreshAssetsFromServer,
    applySnapshot: applySnapshotToYjs,
    invalidateFormulaFieldMeta,
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

/**
 * Like {@link useLibraryData} but returns null instead of throwing when used
 * outside a LibraryDataProvider. Lets components consume the context when
 * present while safely falling back (e.g. in TopBar or tests) — without
 * conditionally calling the hook, which violates the rules of hooks.
 */
export function useLibraryDataOptional(): LibraryDataContextValue | null {
  return useContext(LibraryDataContext);
}
