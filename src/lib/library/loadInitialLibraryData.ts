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
}: RunLatestLibraryHydrationArgs): Promise<boolean> {
  const generation = generationRef.current + 1;
  generationRef.current = generation;

  setIsLoading(true);
  setIsSynced(false);

  const isLatestMountedGeneration = () =>
    isMounted() && generationRef.current === generation;

  try {
    const assetRows = await fetchAssetRows();
    if (!isLatestMountedGeneration()) return false;

    hydrate(assetRows);
    setIsSynced(true);
    return true;
  } catch (error) {
    if (!isLatestMountedGeneration()) return false;

    setIsSynced(false);
    onError(error);
    return false;
  } finally {
    if (isLatestMountedGeneration()) {
      setIsLoading(false);
    }
  }
}
