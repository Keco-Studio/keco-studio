import { beforeEach, describe, expect, it } from '@jest/globals';
import {
  DIRECT_MAP_PAID_NOTICE_STORAGE_KEY,
  DIRECT_MAP_PAID_NOTICE_TTL_MS,
  shouldShowDirectMapPaidNotice,
  suppressDirectMapPaidNoticeForToday,
} from '@/features/create-map/paidGenerationNotice';

describe('direct map paid generation notice', () => {
  const values = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  } as unknown as Storage;

  beforeEach(() => {
    values.clear();
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage } });
  });

  it('shows the notice until the user suppresses it for 24 hours', () => {
    const now = 1_000_000;
    expect(shouldShowDirectMapPaidNotice(now)).toBe(true);
    suppressDirectMapPaidNoticeForToday(now);
    expect(values.get(DIRECT_MAP_PAID_NOTICE_STORAGE_KEY)).toBe(String(now + DIRECT_MAP_PAID_NOTICE_TTL_MS));
    expect(shouldShowDirectMapPaidNotice(now + DIRECT_MAP_PAID_NOTICE_TTL_MS - 1)).toBe(false);
    expect(shouldShowDirectMapPaidNotice(now + DIRECT_MAP_PAID_NOTICE_TTL_MS)).toBe(true);
  });

  it('recovers from an invalid stored value', () => {
    values.set(DIRECT_MAP_PAID_NOTICE_STORAGE_KEY, 'not-a-date');
    expect(shouldShowDirectMapPaidNotice()).toBe(true);
    expect(values.has(DIRECT_MAP_PAID_NOTICE_STORAGE_KEY)).toBe(false);
  });
});
