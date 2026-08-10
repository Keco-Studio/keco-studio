export async function submitMapAssetsSequentially<T>(
  assets: readonly T[],
  submit: (asset: T) => Promise<void>
): Promise<PromiseSettledResult<void>[]> {
  const results: PromiseSettledResult<void>[] = [];
  for (const asset of assets) {
    try {
      await submit(asset);
      results.push({ status: 'fulfilled', value: undefined });
    } catch (reason) {
      results.push({ status: 'rejected', reason });
    }
  }
  return results;
}

export async function submitMapAssetsInBatches<T>(
  assets: readonly T[],
  submit: (asset: T) => Promise<void>,
  onBatchSettled: (
    batch: readonly T[],
    results: readonly PromiseSettledResult<void>[]
  ) => Promise<void>,
  batchSize: number
): Promise<PromiseSettledResult<void>[]> {
  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new Error('PixelLab batch size must be a positive integer');
  }
  const results: PromiseSettledResult<void>[] = [];
  for (let offset = 0; offset < assets.length; offset += batchSize) {
    const batch = assets.slice(offset, offset + batchSize);
    const batchResults = await submitMapAssetsSequentially(batch, submit);
    results.push(...batchResults);
    await onBatchSettled(batch, batchResults);
  }
  return results;
}

export async function waitForMapAssetBatch(
  assetIds: readonly string[],
  poll: (assetId: string) => Promise<void>,
  readStatuses: () => Promise<ReadonlyMap<string, string>>,
  options: {
    maxCycles?: number;
    delay?: () => Promise<void>;
    shouldContinue?: () => boolean;
  } = {},
): Promise<void> {
  const remaining = new Set(assetIds);
  const maxCycles = options.maxCycles ?? 120;
  const delay = options.delay ?? (() => new Promise<void>((resolve) => setTimeout(resolve, 2500)));
  const assertActive = () => {
    if (options.shouldContinue?.() === false) throw new Error('Map asset batch cancelled.');
  };
  for (let cycle = 0; remaining.size > 0 && cycle < maxCycles; cycle += 1) {
    assertActive();
    await delay();
    assertActive();
    await Promise.allSettled([...remaining].map(poll));
    assertActive();
    const statuses = await readStatuses();
    assertActive();
    for (const assetId of remaining) {
      const status = statuses.get(assetId);
      if (status && status !== 'queued' && status !== 'generating') remaining.delete(assetId);
    }
  }
  if (remaining.size > 0) throw new Error('PixelLab generation batch timed out.');
}
