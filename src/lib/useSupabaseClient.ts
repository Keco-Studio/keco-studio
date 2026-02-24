/**
 * Hook to get a tab-isolated Supabase client instance
 * 
 * Each browser tab gets its own Supabase client with independent session storage.
 * This allows different tabs to log in with different accounts.
 */

import { useMemo } from 'react';
import { createClient } from '@supabase/supabase-js';
import { createTabIsolatedStorageAdapter } from './tabIsolatedStorageAdapter';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Supabase env vars are missing. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.'
  );
}

/**
 * Hook to get a tab-isolated Supabase client
 * Each tab gets its own client instance with independent session storage
 */
export function useSupabaseClient() {
  return useMemo(() => {
    return createClient(supabaseUrl, supabaseAnonKey, {
      realtime: {
        params: {
          eventsPerSecond: 10,
        },
      },
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // Use tab-isolated storage adapter to ensure each tab has independent sessions
        storage: createTabIsolatedStorageAdapter(),
      },
    });
  }, []); // Empty deps - create once per component mount (which is per tab)
}

/**
 * Get a tab-isolated Supabase client (for use outside React components)
 * Note: This creates a new client each time, so prefer useSupabaseClient in components
 */
export function getSupabaseClient() {
  return createClient(supabaseUrl, supabaseAnonKey, {
    realtime: {
      params: {
        eventsPerSecond: 10,
      },
    },
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      storage: createTabIsolatedStorageAdapter(),
    },
  });
}

