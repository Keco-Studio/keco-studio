import { describe, expect, it } from '@jest/globals';
import {
  submitMapAssetsInBatches,
  submitMapAssetsSequentially,
  waitForMapAssetBatch,
} from '@/features/create-map/services/mapGenerationQueue';

describe('Create Map generation submission queue', () => {
  it('submits one PixelLab asset at a time', async () => {
    let active = 0;
    let maxActive = 0;
    const order: string[] = [];

    const results = await submitMapAssetsSequentially(['terrain', 'road', 'object'], async (asset) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      order.push(`start:${asset}`);
      await Promise.resolve();
      order.push(`end:${asset}`);
      active -= 1;
    });

    expect(maxActive).toBe(1);
    expect(order).toEqual([
      'start:terrain', 'end:terrain',
      'start:road', 'end:road',
      'start:object', 'end:object',
    ]);
    expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
  });

  it('continues submitting after one PixelLab asset fails', async () => {
    const submitted: string[] = [];

    const results = await submitMapAssetsSequentially(['terrain', 'road', 'object'], async (asset) => {
      submitted.push(asset);
      if (asset === 'road') throw new Error('provider rejected submission');
    });

    expect(submitted).toEqual(['terrain', 'road', 'object']);
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected', 'fulfilled']);
  });

  it('waits for each provider batch before submitting more assets', async () => {
    let activeJobs = 0;
    let maxActiveJobs = 0;
    const settledBatches: number[][] = [];

    const results = await submitMapAssetsInBatches(
      Array.from({ length: 10 }, (_, index) => index),
      async () => {
        activeJobs += 1;
        maxActiveJobs = Math.max(maxActiveJobs, activeJobs);
      },
      async (batch, batchResults) => {
        settledBatches.push([...batch]);
        activeJobs -= batchResults.filter((result) => result.status === 'fulfilled').length;
      },
      4
    );

    expect(maxActiveJobs).toBe(4);
    expect(settledBatches).toEqual([[0, 1, 2, 3], [4, 5, 6, 7], [8, 9]]);
    expect(results).toHaveLength(10);
  });

  it('keeps provider jobs bounded until each submitted batch becomes terminal', async () => {
    const statuses = new Map<string, string>();
    let maxOutstanding = 0;

    await submitMapAssetsInBatches(
      ['a', 'b', 'c', 'd', 'e'],
      async (assetId) => {
        statuses.set(assetId, 'generating');
        maxOutstanding = Math.max(
          maxOutstanding,
          [...statuses.values()].filter((status) => status === 'generating').length,
        );
      },
      async (batch, results) => {
        const submitted = results.flatMap((result, index) => result.status === 'fulfilled' ? [batch[index]] : []);
        await waitForMapAssetBatch(
          submitted,
          async (assetId) => { statuses.set(assetId, 'ready'); },
          async () => statuses,
          { delay: async () => undefined, maxCycles: 2 },
        );
      },
      2,
    );

    expect(maxOutstanding).toBe(2);
    expect([...statuses.values()].every((status) => status === 'ready')).toBe(true);
  });

  it('stops polling when the installed generation target is replaced', async () => {
    let active = true;
    let pollCount = 0;
    let readCount = 0;

    await expect(waitForMapAssetBatch(
      ['terrain'],
      async () => { pollCount += 1; },
      async () => {
        readCount += 1;
        return new Map([['terrain', 'generating']]);
      },
      {
        delay: async () => { active = false; },
        maxCycles: 2,
        shouldContinue: () => active,
      },
    )).rejects.toThrow('Map asset batch cancelled.');

    expect(pollCount).toBe(0);
    expect(readCount).toBe(0);
  });
});
