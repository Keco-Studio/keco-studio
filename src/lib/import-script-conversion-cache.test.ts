import { afterEach, describe, expect, it, jest } from '@jest/globals';
import {
  getOrResolveStory,
  resetStoryConversionCache,
} from './import-script-conversion-cache';

describe('import script conversion cache', () => {
  afterEach(() => {
    resetStoryConversionCache();
    jest.useRealTimers();
  });

  it('shares a successful conversion between concurrent callers', async () => {
    let release!: (value: { value: string }) => void;
    const resolver = jest.fn(() => new Promise<{ value: string }>((resolve) => {
      release = resolve;
    }));

    const first = getOrResolveStory('source', resolver);
    const second = getOrResolveStory('source', resolver);

    await Promise.resolve();
    expect(resolver).toHaveBeenCalledTimes(1);
    release({ value: 'story' });

    await expect(Promise.all([first, second])).resolves.toEqual([
      { value: { value: 'story' }, cacheHit: false },
      { value: { value: 'story' }, cacheHit: true },
    ]);
  });

  it('does not cache rejected conversions', async () => {
    let calls = 0;
    const resolver = async () => {
      calls += 1;
      if (calls === 1) throw new Error('bad');
      return { value: 'retry' };
    };

    await expect(getOrResolveStory('source', resolver)).rejects.toThrow('bad');
    await expect(getOrResolveStory('source', resolver)).resolves.toEqual({
      value: { value: 'retry' },
      cacheHit: false,
    });
    expect(calls).toBe(2);
  });

  it('uses different keys for different source content', async () => {
    const resolver = jest.fn(async (source: string) => ({ source }));

    await getOrResolveStory('one', resolver);
    await getOrResolveStory('two', resolver);

    expect(resolver).toHaveBeenCalledTimes(2);
  });

  it('keeps audited and validation-only cache variants isolated', async () => {
    const resolver = jest.fn(async () => ({ value: 'story' }));
    const getWithVariant = getOrResolveStory as unknown as (
      source: string,
      resolve: typeof resolver,
      options: { variant: string }
    ) => Promise<unknown>;

    await getWithVariant('same source', resolver, { variant: 'mandatory-audit-v1' });
    await getWithVariant('same source', resolver, { variant: 'document-validation-v1' });

    expect(resolver).toHaveBeenCalledTimes(2);
  });

  it('expires completed entries after the cache TTL', async () => {
    jest.useFakeTimers();
    const resolver = jest.fn(async () => ({ value: 'story' }));

    await getOrResolveStory('source', resolver);
    jest.advanceTimersByTime(10 * 60 * 1000 + 1);
    await getOrResolveStory('source', resolver);

    expect(resolver).toHaveBeenCalledTimes(2);
  });
});
