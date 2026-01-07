/**
 * Hybrid storage adapter for Supabase Auth
 * 
 * Combines the benefits of:
 * - Cookies: Persist across refreshes, accessible on server
 * - SessionStorage: Tab isolation for multi-account support
 * 
 * Strategy:
 * 1. Store session in cookies (persists across refreshes)
 * 2. Store tab ID in localStorage (persists across refreshes)
 * 3. Use sessionStorage for tab-specific operations
 * 4. On initialization, restore session from cookies to sessionStorage
 */

import type { SupportedStorage } from '@supabase/supabase-js';

const TAB_ID_KEY = '__supabase_tab_id__';
const SESSION_COOKIE = 'sb-session';

// Get or create tab ID (persisted in localStorage)
function getTabId(): string {
  if (typeof window === 'undefined') {
    return 'server';
  }

  // Try localStorage first (persists across refreshes)
  let tabId = localStorage.getItem(TAB_ID_KEY);
  
  if (tabId) {
    // Sync to sessionStorage for consistency
    try {
      sessionStorage.setItem(TAB_ID_KEY, tabId);
    } catch (e) {
      // Ignore
    }
    return tabId;
  }

  // Try sessionStorage (backward compatibility)
  tabId = sessionStorage.getItem(TAB_ID_KEY);
  
  if (tabId) {
    // Migrate to localStorage
    try {
      localStorage.setItem(TAB_ID_KEY, tabId);
    } catch (e) {
      // Ignore
    }
    return tabId;
  }

  // Generate new tab ID
  tabId = `tab_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  
  // Store in both localStorage (primary) and sessionStorage (backup)
  try {
    localStorage.setItem(TAB_ID_KEY, tabId);
    sessionStorage.setItem(TAB_ID_KEY, tabId);
  } catch (e) {
    // Fallback to sessionStorage only
    try {
      sessionStorage.setItem(TAB_ID_KEY, tabId);
    } catch (e2) {
      // Last resort: just use the ID without storing
    }
  }
  
  return tabId;
}

// Cookie helpers
function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) {
    return decodeURIComponent(parts.pop()?.split(';').shift() || '');
  }
  return null;
}

function setCookie(name: string, value: string, days: number = 7): void {
  if (typeof document === 'undefined') return;
  const expires = new Date();
  expires.setTime(expires.getTime() + days * 24 * 60 * 60 * 1000);
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires.toUTCString()}; path=/; SameSite=Lax${secure}`;
}

function removeCookie(name: string): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
}

// Detect base storage key from Supabase
function detectBaseStorageKey(): string {
  if (typeof window === 'undefined') {
    return 'sb-auth-token';
  }

  // Check sessionStorage for existing keys
  for (let i = 0; i < sessionStorage.length; i++) {
    const key = sessionStorage.key(i);
    if (key && /^sb-.*-auth-token/.test(key)) {
      // Extract base key (remove tab-specific suffix)
      return key.split('_')[0];
    }
  }

  // Check localStorage
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && /^sb-.*-auth-token/.test(key)) {
      return key.split('_')[0];
    }
  }

  // Default fallback
  return 'sb-auth-token';
}

export function createHybridStorageAdapter(): SupportedStorage {
  const tabId = getTabId();
  const baseKey = detectBaseStorageKey();
  const storageKey = `${baseKey}_${tabId}`;

  // On initialization, try to restore session from cookie to sessionStorage
  // This ensures session persists across page refreshes
  if (typeof window !== 'undefined') {
    try {
      const cookieSession = getCookie(SESSION_COOKIE);
      if (cookieSession) {
        // Always restore from cookie to ensure we have the latest session
        // This handles the case where sessionStorage was cleared but cookie still exists
        try {
          sessionStorage.setItem(storageKey, cookieSession);
        } catch (e) {
          // If sessionStorage is full or unavailable, that's okay
          // The cookie will still be used as fallback in getItem
        }
      }
    } catch (e) {
      // Ignore errors during initialization
    }
  }

  return {
    getItem: (key: string): string | null => {
      if (typeof window === 'undefined') {
        return null;
      }

      try {
        // Map Supabase auth key to our tab-specific key
        const actualKey = (key === baseKey || (key.startsWith('sb-') && key.includes('auth-token'))) 
          ? storageKey 
          : key;

        // First, try sessionStorage (tab-specific)
        let value = sessionStorage.getItem(actualKey);
        
        if (value) {
          // Sync to cookie for persistence
          if (actualKey === storageKey) {
            try {
              setCookie(SESSION_COOKIE, value, 7);
            } catch (e) {
              // Ignore cookie errors
            }
          }
          return value;
        }

        // If not found in sessionStorage, try cookie (for refresh recovery)
        if (actualKey === storageKey) {
          const cookieValue = getCookie(SESSION_COOKIE);
          if (cookieValue) {
            // Restore to sessionStorage for future access
            try {
              sessionStorage.setItem(actualKey, cookieValue);
            } catch (e) {
              // If sessionStorage fails, still return cookie value
              // This ensures session works even if sessionStorage is unavailable
            }
            return cookieValue;
          }
        }

        return null;
      } catch (error) {
        console.error('Hybrid storage getItem error:', error);
        return null;
      }
    },

    setItem: (key: string, value: string): void => {
      if (typeof window === 'undefined') {
        return;
      }

      try {
        // Map Supabase auth key to our tab-specific key
        const actualKey = (key === baseKey || (key.startsWith('sb-') && key.includes('auth-token'))) 
          ? storageKey 
          : key;

        // Store in sessionStorage (tab-specific)
        sessionStorage.setItem(actualKey, value);

        // Also store in cookie for persistence (only for auth tokens)
        if (actualKey === storageKey) {
          setCookie(SESSION_COOKIE, value, 7);
          // Debug log (can be removed later)
          if (process.env.NODE_ENV === 'development') {
            console.log('[HybridStorage] Saved session to cookie');
          }
        }
      } catch (error) {
        console.error('Hybrid storage setItem error:', error);
      }
    },

    removeItem: (key: string): void => {
      if (typeof window === 'undefined') {
        return;
      }

      try {
        // Map Supabase auth key to our tab-specific key
        const actualKey = (key === baseKey || (key.startsWith('sb-') && key.includes('auth-token'))) 
          ? storageKey 
          : key;

        // Remove from sessionStorage
        sessionStorage.removeItem(actualKey);

        // Remove from cookie if it's an auth token
        if (actualKey === storageKey) {
          removeCookie(SESSION_COOKIE);
        }
      } catch (error) {
        console.error('Hybrid storage removeItem error:', error);
      }
    },
  };
}

