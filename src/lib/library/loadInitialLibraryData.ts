import type { MutableRefObject } from 'react';
import type { AssetRow } from '@/lib/types/libraryAssets';

type RunLatestLibraryHydrationArgs = {
  generationRef: MutableRefObject<number> | { current: number };
  isMounted: () => boolean;
  fetchAssetRows: () => Promise<AssetRow[]>;
  hydrate: (rows: AssetRow[]) => void;
  setIsLoading: (value: boolean) => void;
  setIsSynced: (value: boolean) => void;
  onError: (error: unknown) => void;
};

export async function runLatestLibraryHydration({
  generationRef,
  isMounted,
  fetchAssetRows,
  hydrate,
  setIsLoading,
  setIsSynced,
  onError,
}: RunLatestLibraryHydrationArgs): Promise<void> {
  const generation = generationRef.current + 1;
  generationRef.current = generation;

  setIsLoading(true);
  setIsSynced(false);

  const isLatestMountedGeneration = () =>
    isMounted() && generationRef.current === generation;

  try {
    const assetRows = await fetchAssetRows();
    if (!isLatestMountedGeneration()) return;

    hydrate(assetRows);
    setIsSynced(true);
  } catch (error) {
    if (!isLatestMountedGeneration()) return;

    setIsSynced(false);
    onError(error);
  } finally {
    if (isLatestMountedGeneration()) {
      setIsLoading(false);
    }
  }
}
