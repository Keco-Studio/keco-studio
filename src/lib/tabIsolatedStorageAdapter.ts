/**
 * Tab-isolated storage adapter for Supabase Auth
 * 
 * This adapter creates a unique storage key for each browser tab, ensuring
 * each tab has its own completely independent session. This allows users
 * to log in with different accounts in different tabs.
 * 
 * The storage key includes a unique tab ID that persists for the lifetime
 * of the tab, allowing session to persist across page refreshes within the same tab.
 */

import type { SupportedStorage } from '@supabase/supabase-js';

// Get the base storage key (default Supabase key)
const BASE_STORAGE_KEY = 'sb-auth-token';

// Cache the tab ID to ensure consistency within the same tab
let cachedTabId: string | null = null;

// Generate a unique tab ID that persists for the lifetime of this tab
function getTabId(): string {
  if (cachedTabId) {
    return cachedTabId;
  }

  if (typeof window === 'undefined') {
    cachedTabId = 'server';
    return cachedTabId;
  }

  // Try to get existing tab ID from sessionStorage
  const existingTabId = sessionStorage.getItem('__supabase_tab_id__');
  if (existingTabId) {
    cachedTabId = existingTabId;
    return cachedTabId;
  }

  // Generate a new unique tab ID
  const tabId = `tab_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  sessionStorage.setItem('__supabase_tab_id__', tabId);
  cachedTabId = tabId;
  return tabId;
}

export function createTabIsolatedStorageAdapter(): SupportedStorage {
  const tabId = getTabId();
  const storageKey = `${BASE_STORAGE_KEY}_${tabId}`;

  return {
    getItem: (key: string): string | null => {
      if (typeof window === 'undefined') {
        return null;
      }
      try {
        // Map the default key to our tab-specific key
        const actualKey = key === BASE_STORAGE_KEY ? storageKey : key;
        return window.sessionStorage.getItem(actualKey);
      } catch (error) {
        console.error('Tab-isolated storage.getItem error:', error);
        return null;
      }
    },

    setItem: (key: string, value: string): void => {
      if (typeof window === 'undefined') {
        return;
      }
      try {
        // Map the default key to our tab-specific key
        const actualKey = key === BASE_STORAGE_KEY ? storageKey : key;
        window.sessionStorage.setItem(actualKey, value);
      } catch (error) {
        console.error('Tab-isolated storage.setItem error:', error);
      }
    },

    removeItem: (key: string): void => {
      if (typeof window === 'undefined') {
        return;
      }
      try {
        // Map the default key to our tab-specific key
        const actualKey = key === BASE_STORAGE_KEY ? storageKey : key;
        window.sessionStorage.removeItem(actualKey);
      } catch (error) {
        console.error('Tab-isolated storage.removeItem error:', error);
      }
    },
  };
}

