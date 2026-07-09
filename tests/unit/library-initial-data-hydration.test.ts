import { describe, expect, it, jest } from '@jest/globals';
import { runLatestLibraryHydration } from '@/lib/library/loadInitialLibraryData';
import type { AssetRow } from '@/lib/types/libraryAssets';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const assetRow = (id: string, name: string): AssetRow => ({
  id,
  libraryId: 'library-1',
  name,
  propertyValues: {},
});

describe('runLatestLibraryHydration', () => {
  it('discards an older fetch that resolves after a newer hydration', async () => {
    const first = deferred<AssetRow[]>();
    const second = deferred<AssetRow[]>();
    const fetchAssetRows = jest
      .fn<() => Promise<AssetRow[]>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const hydrate = jest.fn<(rows: AssetRow[]) => void>();
    const setIsLoading = jest.fn<(value: boolean) => void>();
    const setIsSynced = jest.fn<(value: boolean) => void>();
    const generationRef = { current: 0 };

    const firstLoad = runLatestLibraryHydration({
      generationRef,
      isMounted: () => true,
      fetchAssetRows,
      hydrate,
      setIsLoading,
      setIsSynced,
      onError: () => {},
    });
    const secondLoad = runLatestLibraryHydration({
      generationRef,
      isMounted: () => true,
      fetchAssetRows,
      hydrate,
      setIsLoading,
      setIsSynced,
      onError: () => {},
    });

    second.resolve([assetRow('newer', 'Newer')]);
    await secondLoad;
    first.resolve([assetRow('older', 'Older')]);
    await firstLoad;

    expect(hydrate).toHaveBeenCalledTimes(1);
    expect(hydrate).toHaveBeenCalledWith([assetRow('newer', 'Newer')]);
    expect(setIsSynced).toHaveBeenLastCalledWith(true);
    expect(setIsLoading).toHaveBeenLastCalledWith(false);
  });

  it('hydrates and updates sync state for a single latest fetch', async () => {
    const fetchAssetRows = jest.fn<() => Promise<AssetRow[]>>().mockResolvedValue([
      assetRow('asset-1', 'Single'),
    ]);
    const hydrate = jest.fn<(rows: AssetRow[]) => void>();
    const setIsLoading = jest.fn<(value: boolean) => void>();
    const setIsSynced = jest.fn<(value: boolean) => void>();

    await runLatestLibraryHydration({
      generationRef: { current: 0 },
      isMounted: () => true,
      fetchAssetRows,
      hydrate,
      setIsLoading,
      setIsSynced,
      onError: () => {},
    });

    expect(hydrate).toHaveBeenCalledWith([assetRow('asset-1', 'Single')]);
    expect(setIsLoading).toHaveBeenNthCalledWith(1, true);
    expect(setIsSynced).toHaveBeenNthCalledWith(1, false);
    expect(setIsSynced).toHaveBeenLastCalledWith(true);
    expect(setIsLoading).toHaveBeenLastCalledWith(false);
  });

  it('does not let stale errors overwrite the latest successful sync state', async () => {
    const first = deferred<AssetRow[]>();
    const second = deferred<AssetRow[]>();
    const fetchAssetRows = jest
      .fn<() => Promise<AssetRow[]>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const hydrate = jest.fn<(rows: AssetRow[]) => void>();
    const setIsSynced = jest.fn<(value: boolean) => void>();
    const onError = jest.fn<(error: unknown) => void>();
    const generationRef = { current: 0 };

    const firstLoad = runLatestLibraryHydration({
      generationRef,
      isMounted: () => true,
      fetchAssetRows,
      hydrate,
      setIsLoading: () => {},
      setIsSynced,
      onError,
    });
    const secondLoad = runLatestLibraryHydration({
      generationRef,
      isMounted: () => true,
      fetchAssetRows,
      hydrate,
      setIsLoading: () => {},
      setIsSynced,
      onError,
    });

    second.resolve([assetRow('newer', 'Newer')]);
    await secondLoad;
    first.reject(new Error('stale failure'));
    await firstLoad;

    expect(hydrate).toHaveBeenCalledWith([assetRow('newer', 'Newer')]);
    expect(onError).not.toHaveBeenCalled();
    expect(setIsSynced).toHaveBeenLastCalledWith(true);
  });
});
