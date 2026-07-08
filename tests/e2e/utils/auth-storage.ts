import type { Page } from '@playwright/test';

export async function waitForSupabaseAuthStorage(
  page: Page,
  timeout = 30000
): Promise<void> {
  await page.waitForFunction(
    () => {
      try {
        const storages = [sessionStorage, localStorage];
        for (const storage of storages) {
          const keys = Object.keys(storage);
          for (const key of keys) {
            if (!key.includes('sb-') || !key.includes('auth-token')) continue;

            const value = storage.getItem(key);
            if (!value) continue;

            try {
              const parsed = JSON.parse(value) as { access_token?: unknown };
              if (
                parsed &&
                typeof parsed.access_token === 'string' &&
                parsed.access_token.length > 10
              ) {
                return true;
              }
            } catch {
              if (value.length > 10) return true;
            }
          }
        }
        return false;
      } catch {
        return false;
      }
    },
    { timeout }
  );
}
