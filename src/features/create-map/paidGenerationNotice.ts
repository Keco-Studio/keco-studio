export const DIRECT_MAP_PAID_NOTICE_STORAGE_KEY = 'keco.direct-map.paid-notice-until';
export const DIRECT_MAP_PAID_NOTICE_TTL_MS = 24 * 60 * 60 * 1000;

function storage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function shouldShowDirectMapPaidNotice(now = Date.now()): boolean {
  const store = storage();
  if (!store) return true;
  let value: string | null;
  try {
    value = store.getItem(DIRECT_MAP_PAID_NOTICE_STORAGE_KEY);
  } catch {
    return true;
  }
  if (!value) return true;
  const until = Number(value);
  if (!Number.isFinite(until) || until <= now) {
    try {
      store.removeItem(DIRECT_MAP_PAID_NOTICE_STORAGE_KEY);
    } catch {
      // Storage is optional; an expired value should still behave as visible.
    }
    return true;
  }
  return false;
}

export function suppressDirectMapPaidNoticeForToday(now = Date.now()): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(
      DIRECT_MAP_PAID_NOTICE_STORAGE_KEY,
      String(now + DIRECT_MAP_PAID_NOTICE_TTL_MS),
    );
  } catch {
    // A blocked or full storage should not prevent a paid request from proceeding.
  }
}
