import type * as Y from 'yjs';
import type { QueryClient } from '@tanstack/react-query';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ReferenceCellUpdate } from '@/lib/services/referenceSyncService';
import { syncReferencesForSourceChanges } from '@/lib/services/referenceSyncService';
import { serializeError } from '@/lib/utils/errorUtils';
import { invalidateLibraryAssetsData } from '@/lib/queryInvalidation';

type ApplyReferenceSyncArgs = {
  refUpdates: ReferenceCellUpdate[];
  libraryId: string;
  yDoc: Y.Doc;
  yAssets: Y.Map<Y.Map<unknown>>;
  queryClient: QueryClient;
  loadInitialData: () => Promise<void>;
};

export function applyReferenceSyncToLocalState({
  refUpdates,
  libraryId,
  yDoc,
  yAssets,
  queryClient,
  loadInitialData,
}: ApplyReferenceSyncArgs): void {
  if (refUpdates.length === 0) return;

  yDoc.transact(() => {
    for (const update of refUpdates) {
      if (update.referencingLibraryId !== libraryId) continue;
      const yAsset = yAssets.get(update.referencingAssetId);
      if (!yAsset) continue;
      const yPropertyValues = yAsset.get('propertyValues') as Y.Map<unknown> | undefined;
      if (!yPropertyValues) continue;
      let valueForYjs = update.newReferenceValue;
      if (valueForYjs !== null && typeof valueForYjs === 'object') {
        valueForYjs = JSON.parse(JSON.stringify(valueForYjs)) as unknown;
      }
      yPropertyValues.set(update.referencingFieldId, valueForYjs);
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
  yDoc: Y.Doc;
  yAssets: Y.Map<Y.Map<unknown>>;
  loadInitialData: () => Promise<void>;
  assetId: string;
  fieldId: string;
  valueJson: unknown;
};

export async function syncReferencesAfterSourceChange({
  supabase,
  queryClient,
  libraryId,
  yDoc,
  yAssets,
  loadInitialData,
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
      yDoc,
      yAssets,
      queryClient,
      loadInitialData,
    });
    await invalidateLibraryAssetsData(queryClient, { libraryId, assetId });
  } catch (error) {
    console.error(
      `[LibraryDataContext] reference sync failed: assetId=${assetId} fieldId=${fieldId}`,
      serializeError(error)
    );
  }
}
