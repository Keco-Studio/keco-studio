/**
 * SessionStorage adapter for Supabase Auth
 * 
 * This adapter uses sessionStorage instead of localStorage to ensure
 * each browser tab has its own independent session. This allows users
 * to log in with different accounts in different tabs.
 * 
 * sessionStorage is tab-specific and does not persist across browser sessions,
 * but it persists across page refreshes within the same tab.
 */

import type { SupportedStorage } from '@supabase/supabase-js';

export const sessionStorageAdapter: SupportedStorage = {
  getItem: (key: string): string | null => {
    if (typeof window === 'undefined') {
      return null;
    }
    try {
      return window.sessionStorage.getItem(key);
    } catch (error) {
      console.error('sessionStorage.getItem error:', error);
      return null;
    }
  },

  setItem: (key: string, value: string): void => {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      window.sessionStorage.setItem(key, value);
    } catch (error) {
      console.error('sessionStorage.setItem error:', error);
    }
  },

  removeItem: (key: string): void => {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      window.sessionStorage.removeItem(key);
    } catch (error) {
      console.error('sessionStorage.removeItem error:', error);
    }
  },
};

