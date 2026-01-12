/**
 * Cookie-based storage adapter for Supabase Auth
 * 
 * This adapter stores session tokens in cookies, allowing them to persist
 * across page refreshes and be accessible on both client and server.
 * 
 * It also maintains backward compatibility with sessionStorage for tab isolation.
 */

import type { SupportedStorage } from '@supabase/supabase-js';

// Cookie names
const ACCESS_TOKEN_COOKIE = 'sb-access-token';
const REFRESH_TOKEN_COOKIE = 'sb-refresh-token';
const SESSION_COOKIE = 'sb-session';

// Helper to get cookie value
function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  
  if (parts.length === 2) {
    return parts.pop()?.split(';').shift() || null;
  }
  return null;
}

// Helper to set cookie
function setCookie(name: string, value: string, days: number = 365): void {
  if (typeof document === 'undefined') return;
  
  const expires = new Date();
  expires.setTime(expires.getTime() + days * 24 * 60 * 60 * 1000);
  
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  document.cookie = `${name}=${value}; expires=${expires.toUTCString()}; path=/; SameSite=Lax${secure}`;
}

// Helper to remove cookie
function removeCookie(name: string): void {
  if (typeof document === 'undefined') return;
  
  document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
}

// Get the base storage key (Supabase's default key)
function getBaseStorageKey(): string {
  // Try to detect the actual Supabase key from sessionStorage
  if (typeof window !== 'undefined') {
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key && /^sb-.*-auth-token/.test(key)) {
        // Extract base key (remove any tab-specific suffix)
        return key.split('_')[0];
      }
    }
  }
  return 'sb-auth-token';
}

export function createCookieStorageAdapter(): SupportedStorage {
  const baseKey = getBaseStorageKey();

  return {
    getItem: (key: string): string | null => {
      if (typeof window === 'undefined') {
        return null;
      }

      try {
        // If it's the Supabase auth token key, try cookies first
        if (key === baseKey || key.startsWith('sb-') && key.includes('auth-token')) {
          // Try to get from cookie
          const sessionCookie = getCookie(SESSION_COOKIE);
          if (sessionCookie) {
            try {
              const session = JSON.parse(sessionCookie);
              if (session && session.access_token) {
                return sessionCookie;
              }
            } catch (e) {
              // Invalid JSON, continue to sessionStorage
            }
          }

          // Fallback to sessionStorage (for backward compatibility)
          const sessionStorageValue = sessionStorage.getItem(key);
          if (sessionStorageValue) {
            // Also sync to cookie for persistence (longer expiry)
            try {
              setCookie(SESSION_COOKIE, sessionStorageValue, 365);
            } catch (e) {
              // Ignore cookie errors
            }
            return sessionStorageValue;
          }

          return null;
        }

        // For other keys, use sessionStorage
        return sessionStorage.getItem(key);
      } catch (error) {
        console.error('Cookie storage getItem error:', error);
        return null;
      }
    },

    setItem: (key: string, value: string): void => {
      if (typeof window === 'undefined') {
        return;
      }

      try {
        // If it's the Supabase auth token key, store in both cookie and sessionStorage
        if (key === baseKey || (key.startsWith('sb-') && key.includes('auth-token'))) {
          // Store in cookie for persistence across refreshes (longer expiry)
          setCookie(SESSION_COOKIE, value, 365);
          
          // Also store in sessionStorage for immediate access
          sessionStorage.setItem(key, value);
          
          // Parse and store individual tokens for middleware access
          try {
            const session = JSON.parse(value);
            if (session?.access_token) {
              setCookie(ACCESS_TOKEN_COOKIE, session.access_token, 365);
            }
            if (session?.refresh_token) {
              // Refresh token should be httpOnly, but we can't set that from client
              // Middleware will handle httpOnly cookies
            }
          } catch (e) {
            // Not JSON, just store as-is
          }
        } else {
          // For other keys, use sessionStorage
          sessionStorage.setItem(key, value);
        }
      } catch (error) {
        console.error('Cookie storage setItem error:', error);
      }
    },

    removeItem: (key: string): void => {
      if (typeof window === 'undefined') {
        return;
      }

      try {
        // If it's the Supabase auth token key, remove from both
        if (key === baseKey || (key.startsWith('sb-') && key.includes('auth-token'))) {
          removeCookie(SESSION_COOKIE);
          removeCookie(ACCESS_TOKEN_COOKIE);
          removeCookie(REFRESH_TOKEN_COOKIE);
          sessionStorage.removeItem(key);
        } else {
          sessionStorage.removeItem(key);
        }
      } catch (error) {
        console.error('Cookie storage removeItem error:', error);
      }
    },
  };
}

