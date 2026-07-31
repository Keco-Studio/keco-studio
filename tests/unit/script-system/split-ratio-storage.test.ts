import { describe, expect, it, beforeEach } from '@jest/globals';

function installLocalStorage() {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => store.clear(),
    },
    configurable: true,
  });
  Object.defineProperty(globalThis, 'window', {
    value: globalThis,
    configurable: true,
  });
  return store;
}

describe('splitRatioStorage', () => {
  beforeEach(() => {
    installLocalStorage();
  });

  it('uses key keco.script.splitRatio and defaults to 0.68', async () => {
    const {
      SPLIT_RATIO_KEY,
      DEFAULT_SPLIT_RATIO,
      readSplitRatio,
    } = await import('@/lib/script-system/splitRatioStorage');

    expect(SPLIT_RATIO_KEY).toBe('keco.script.splitRatio');
    expect(DEFAULT_SPLIT_RATIO).toBe(0.68);
    expect(readSplitRatio()).toBe(0.68);
  });

  it('clamps ratios to roughly 0.35–0.8', async () => {
    const { clampSplitRatio, writeSplitRatio, readSplitRatio } =
      await import('@/lib/script-system/splitRatioStorage');

    expect(clampSplitRatio(0.1)).toBe(0.35);
    expect(clampSplitRatio(0.99)).toBe(0.8);
    expect(clampSplitRatio(0.5)).toBe(0.5);
    expect(clampSplitRatio(Number.NaN)).toBe(0.68);

    writeSplitRatio(0.05);
    expect(readSplitRatio()).toBe(0.35);
    writeSplitRatio(0.95);
    expect(readSplitRatio()).toBe(0.8);
  });

  it('round-trips a valid ratio', async () => {
    const { writeSplitRatio, readSplitRatio } = await import(
      '@/lib/script-system/splitRatioStorage'
    );

    writeSplitRatio(0.72);
    expect(readSplitRatio()).toBe(0.72);
  });
});
