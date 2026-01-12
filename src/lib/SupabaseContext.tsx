/**
 * Supabase Context Provider
 * 
 * Provides a tab-isolated Supabase client instance to all child components.
 * Each browser tab gets its own independent client with separate session storage.
 */

'use client';

import { createContext, useContext, useMemo, ReactNode } from 'react';
import { createClient } from '@supabase/supabase-js';
import { createHybridStorageAdapter } from './hybridStorageAdapter';
import type { SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Supabase env vars are missing. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.'
  );
}

const SupabaseContext = createContext<SupabaseClient | null>(null);

export function SupabaseProvider({ children }: { children: ReactNode }) {
  const supabase = useMemo(() => {
    return createClient(supabaseUrl, supabaseAnonKey, {
      realtime: {
        params: {
          eventsPerSecond: 10,
        },
      },
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        // Use hybrid storage adapter: cookies for persistence + sessionStorage for tab isolation
        storage: createHybridStorageAdapter(),
        // Increase token refresh time to prevent premature expiration
        // Refresh when token has less than 60 seconds left (default is 10)
        flowType: 'pkce',
      },
    });
  }, []); // Empty deps - create once per component mount (which is per tab)

  return (
    <SupabaseContext.Provider value={supabase}>
      {children}
    </SupabaseContext.Provider>
  );
}

export function useSupabase() {
  const context = useContext(SupabaseContext);
  if (!context) {
    throw new Error('useSupabase must be used within SupabaseProvider');
  }
  return context;
}

