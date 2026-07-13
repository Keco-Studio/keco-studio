/**
 * LibraryDataContext
 * 
 * Unified data management layer for collaborative editing across:
 * - LibraryAssetsTable (table view)
 * - AssetPage (detail view)
 * 
 * Features:
 * - Single observable asset store
 * - Realtime synchronization (Supabase Realtime)
 * - Presence tracking
 * - Optimistic updates
 * - Conflict resolution
 */

'use client';

import React, { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
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
  hydrateAssetStoreFromRows,
  hydrateAssetStoreFromSnapshot,
  ObservableAssetStore,
  type LibrarySnapshotData,
} from '@/lib/library/assetStore';
import { runLatestLibraryHydration } from '@/lib/library/loadInitialLibraryData';
import { useLibraryAssetMutations } from '@/components/libraries/hooks/useLibraryAssetMutations';
import { useLibraryRealtimeHandlers } from '@/components/libraries/hooks/useLibraryRealtimeHandlers';
import { useQueryClient } from '@tanstack/react-query';
import { invalidateLibraryAssetsData } from '@/lib/queryInvalidation';
import { LIBRARY_RECONCILE_EVENT } from '@/lib/realtime/cell-replacement-broadcast';

interface LibraryDataContextValue {
  // Data access
  assets: ReadonlyMap<string, AssetRow>;
  getAsset: (assetId: string) => AssetRow | undefined;
  allAssets: AssetRow[];

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

  assetStore: ObservableAssetStore;

  // Loading states
  isLoading: boolean;
  isSynced: boolean;
}

const LibraryDataContext = createContext<LibraryDataContextValue | null>(null);
type LibraryActionsContextValue = Pick<
  LibraryDataContextValue,
  | 'getAsset'
  | 'updateAssetField'
  | 'updateAssetName'
  | 'createAsset'
  | 'deleteAsset'
  | 'refreshAssetsFromServer'
  | 'applySnapshot'
  | 'invalidateFormulaFieldMeta'
  | 'updateMultipleFields'
  | 'updateAssetsBatch'
  | 'getUsersEditingField'
  | 'setActiveField'
>;
const LibraryActionsContext = createContext<LibraryActionsContextValue | null>(null);

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
  const profileUserId = userProfile?.id;
  const profileEmail = userProfile?.email ?? '';
  const profileDisplayName =
    userProfile?.username || userProfile?.full_name || profileEmail || 'Anonymous';

  const assetStore = useMemo(() => {
    void libraryId;
    return new ObservableAssetStore();
  }, [libraryId]);

  // State
  const assets = useSyncExternalStore(
    assetStore.subscribe,
    assetStore.getSnapshot,
    assetStore.getSnapshot
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isSynced, setIsSynced] = useState(false);

  // Refs to avoid stale closures
  const assetsRef = useRef<ReadonlyMap<string, AssetRow>>(new Map());
  const isMountedRef = useRef(true);
  const loadInitialDataGenerationRef = useRef(0);
  // Track asset IDs created during a batch insert (skipReload=true) so that
  // Track batch inserts until the complete row-order payload is broadcast.
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

  // Load initial data from database (can be reused after restore)
  const loadInitialData = useCallback(async () => {
    if (!libraryId || !isAuthenticated || !profileUserId) return;

    await runLatestLibraryHydration({
      generationRef: loadInitialDataGenerationRef,
      isMounted: () => isMountedRef.current,
      // Use the same service as version snapshots so the current view and
      // saved snapshots read the same row shape.
      fetchAssetRows: () => getLibraryAssetsWithProperties(supabase, libraryId),
      hydrate: (assetRows) => hydrateAssetStoreFromRows(assetStore, assetRows),
      setIsLoading,
      setIsSynced,
      onError: (error) => {
        console.error('[LibraryDataContext] Failed to load initial data:', error);
      },
    });
  }, [assetStore, libraryId, isAuthenticated, profileUserId, supabase]);

  const invalidateFormulaFieldMeta = useCallback(() => {
    formulaFieldMetaCache.invalidate(libraryId);
  }, [formulaFieldMetaCache, libraryId]);

  // After restore, apply the snapshot directly so the current view matches
  // the restored version before the next server refresh arrives.
  const applySnapshotToStore = useCallback((snapshotData: LibrarySnapshotData) => {
    hydrateAssetStoreFromSnapshot(assetStore, libraryId, snapshotData);
  }, [assetStore, libraryId]);

  // Initial load (wait for auth so RLS-backed queries have a valid session)
  useEffect(() => {
    if (isAuthLoading || !isAuthenticated || !profileUserId) return;
    loadInitialData();
  }, [loadInitialData, isAuthLoading, isAuthenticated, profileUserId]);

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
    assetStore,
    libraryId,
    pendingBatchInsertIdsRef,
  });

  const handleVersionChange = useCallback((payload: any) => {
    const newRecord = payload.new as Record<string, unknown> | undefined;
    const oldRecord = payload.old as Record<string, unknown> | undefined;
    const eventLibraryId = newRecord?.library_id ?? oldRecord?.library_id;
    if (eventLibraryId && eventLibraryId !== libraryId) return;

    void queryClient.invalidateQueries({ queryKey: ['versions', libraryId] });
    if (payload.eventType === 'INSERT' && newRecord?.version_type === 'restore') {
      void loadInitialData();
    }
  }, [libraryId, loadInitialData, queryClient]);

  // Initialize realtime subscription
  const realtimeConfig = useMemo(() => ({
      libraryId: profileUserId ? libraryId : '',
      currentUserId: profileUserId ?? '',
      currentUserName: profileDisplayName,
      currentUserEmail: profileEmail,
      avatarColor: profileUserId ? getUserAvatarColor(profileUserId) : '#999999',
      onCellUpdate: handleCellUpdateEvent,
      onAssetCreate: handleAssetCreateEvent,
      onAssetDelete: handleAssetDeleteEvent,
      onConflict: handleConflictEvent,
      onRowOrderChange: handleRowOrderChangeEvent,
      onCellsBatchUpdate: handleCellsBatchUpdateEvent,
      onReconnect: loadInitialData,
      onVersionChange: handleVersionChange,
  }), [libraryId, profileUserId, profileDisplayName, profileEmail, handleCellUpdateEvent, handleAssetCreateEvent, handleAssetDeleteEvent, handleConflictEvent, handleRowOrderChangeEvent, handleCellsBatchUpdateEvent, loadInitialData, handleVersionChange]);

  const realtimeSubscription = useRealtimeSubscription(realtimeConfig);

  const { connectionStatus, broadcastCellUpdate, broadcastAssetCreate, broadcastAssetDelete, broadcastCellsBatchUpdate, broadcastRowOrderChange } =
    realtimeSubscription;

  // Presence tracking - use useMemo to avoid recreating config on every render
  const presenceConfig = useMemo(() => ({
    libraryId: libraryId || '',
    userId: profileUserId || '',
    userName: profileDisplayName,
    userEmail: profileEmail,
    avatarColor: profileUserId ? getUserAvatarColor(profileUserId) : '#999999',
    debugLabel: 'LibraryData',
  }), [libraryId, profileUserId, profileDisplayName, profileEmail]);

  const presenceTracking = usePresenceTracking(presenceConfig);

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
    assetStore,
    assetsRef,
    pendingBatchInsertIdsRef,
    getFormulaFieldMeta,
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

  useEffect(() => {
    const reconcile = (rawEvent: Event) => {
      const event = rawEvent as CustomEvent<{ libraryIds?: string[] }>;
      if (!event.detail?.libraryIds?.includes(libraryId)) return;
      void loadInitialData();
    };
    window.addEventListener(LIBRARY_RECONCILE_EVENT, reconcile);
    return () => window.removeEventListener(LIBRARY_RECONCILE_EVENT, reconcile);
  }, [libraryId, loadInitialData]);

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
  const allAssets = useMemo(() => {
    return Array.from(assets.values()).sort(compareAssetsForUiRow);
  }, [assets]);

  // Cleanup
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const actionsValue = useMemo<LibraryActionsContextValue>(() => ({
    getAsset,
    updateAssetField,
    updateAssetName,
    createAsset,
    deleteAsset,
    refreshAssetsFromServer,
    applySnapshot: applySnapshotToStore,
    invalidateFormulaFieldMeta,
    updateMultipleFields,
    updateAssetsBatch,
    getUsersEditingField,
    setActiveField,
  }), [
    applySnapshotToStore,
    createAsset,
    deleteAsset,
    getAsset,
    getUsersEditingField,
    invalidateFormulaFieldMeta,
    refreshAssetsFromServer,
    setActiveField,
    updateAssetField,
    updateAssetName,
    updateAssetsBatch,
    updateMultipleFields,
  ]);

  const contextValue = useMemo<LibraryDataContextValue>(() => ({
    assets,
    allAssets,
    ...actionsValue,
    connectionStatus,
    presenceUsers: presenceTracking.presenceUsers || [],
    assetStore,
    isLoading,
    isSynced,
  }), [
    actionsValue,
    allAssets,
    assets,
    connectionStatus,
    isLoading,
    isSynced,
    presenceTracking.presenceUsers,
    assetStore,
  ]);

  return (
    <LibraryActionsContext.Provider value={actionsValue}>
      <LibraryDataContext.Provider value={contextValue}>
        {children}
      </LibraryDataContext.Provider>
    </LibraryActionsContext.Provider>
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

export function useLibraryActions(): LibraryActionsContextValue {
  const context = useContext(LibraryActionsContext);
  if (!context) {
    throw new Error('useLibraryActions must be used within LibraryDataProvider');
  }
  return context;
}
