import type { Page } from '@playwright/test';

export async function waitForSupabaseAuthStorage(
  page: Page,
  timeout = 30000
): Promise<void> {
  await page.waitForFunction(
    () => {
      const looksLikeToken = (value: string | null | undefined): boolean => {
        if (!value) return false;
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
          // Cookie/base64 chunked tokens are not JSON; fall back to a length check.
          if (value.length > 10) return true;
        }
        return false;
      };

      try {
        // The browser client uses @supabase/ssr createBrowserClient, which
        // persists the session in COOKIES (sb-<ref>-auth-token, possibly
        // chunked as ...-auth-token.0/.1). Older builds used localStorage. Check
        // cookies first, then storage, so this works across both.
        const cookiePairs = document.cookie ? document.cookie.split(';') : [];
        for (const pair of cookiePairs) {
          const eq = pair.indexOf('=');
          const name = (eq === -1 ? pair : pair.slice(0, eq)).trim();
          if (!name.includes('sb-') || !name.includes('auth-token')) continue;
          const value = eq === -1 ? '' : decodeURIComponent(pair.slice(eq + 1));
          if (looksLikeToken(value) || value.length > 10) return true;
        }

        const storages = [sessionStorage, localStorage];
        for (const storage of storages) {
          const keys = Object.keys(storage);
          for (const key of keys) {
            if (!key.includes('sb-') || !key.includes('auth-token')) continue;
            if (looksLikeToken(storage.getItem(key))) return true;
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
