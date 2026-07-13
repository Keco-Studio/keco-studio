import type { QueryClient } from '@tanstack/react-query';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ReferenceCellUpdate } from '@/lib/services/referenceSyncService';
import { syncReferencesForSourceChanges } from '@/lib/services/referenceSyncService';
import { serializeError } from '@/lib/utils/errorUtils';
import { invalidateLibraryAssetsData } from '@/lib/queryInvalidation';
import { cloneStoreValue, type ObservableAssetStore } from './assetStore';

type ApplyReferenceSyncArgs = {
  refUpdates: ReferenceCellUpdate[];
  libraryId: string;
  assetStore: ObservableAssetStore;
  queryClient: QueryClient;
};

export function applyReferenceSyncToLocalState({
  refUpdates,
  libraryId,
  assetStore,
  queryClient,
}: ApplyReferenceSyncArgs): void {
  if (refUpdates.length === 0) return;

  assetStore.transact(() => {
    for (const update of refUpdates) {
      if (update.referencingLibraryId !== libraryId) continue;
      const asset = assetStore.get(update.referencingAssetId);
      if (!asset) continue;
      assetStore.set({
        ...asset,
        propertyValues: {
          ...asset.propertyValues,
          [update.referencingFieldId]: cloneStoreValue(update.newReferenceValue),
        },
      });
    }
  });

  const libraryIdsToReload = new Set(
    refUpdates.map((update) => update.referencingLibraryId).filter(Boolean)
  );
  libraryIdsToReload.forEach((id) => {
    void invalidateLibraryAssetsData(queryClient, { libraryId: id });
  });

  const referencingAssetIds = new Set(refUpdates.map((update) => update.referencingAssetId));
  referencingAssetIds.forEach((refAssetId) => {
    const libId =
      refUpdates.find((update) => update.referencingAssetId === refAssetId)?.referencingLibraryId ??
      libraryId;
    void invalidateLibraryAssetsData(queryClient, {
      libraryId: libId,
      assetId: refAssetId,
    });
  });
}

type SyncReferencesAfterSourceChangeArgs = {
  supabase: SupabaseClient;
  queryClient: QueryClient;
  libraryId: string;
  assetStore: ObservableAssetStore;
  assetId: string;
  fieldId: string;
  valueJson: unknown;
};

export async function syncReferencesAfterSourceChange({
  supabase,
  queryClient,
  libraryId,
  assetStore,
  assetId,
  fieldId,
  valueJson,
}: SyncReferencesAfterSourceChangeArgs): Promise<void> {
  try {
    const refUpdates = await syncReferencesForSourceChanges(supabase, [
      { assetId, fieldId, valueJson },
    ]);
    applyReferenceSyncToLocalState({
      refUpdates,
      libraryId,
      assetStore,
      queryClient,
    });
    await invalidateLibraryAssetsData(queryClient, { libraryId, assetId });
  } catch (error) {
    console.error(
      `[LibraryDataContext] reference sync failed: assetId=${assetId} fieldId=${fieldId}`,
      serializeError(error)
    );
  }
}
