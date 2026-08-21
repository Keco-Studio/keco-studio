'use client';

import { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef, ReactNode } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { useQueryClient } from '@tanstack/react-query';
import { useSupabase } from '@/lib/SupabaseContext';
import type { UserProfile } from '@/lib/types/user';
import {
  areUserProfilesEqual,
  shouldRetryProfileFetch,
  shouldFetchUserProfileForAuthEvent,
} from '@/lib/auth/profile-stability';

function clearAllCaches(queryClient: QueryClient) {
  queryClient.clear();
}

/** Stable string for logs / Next overlay (object args often render as "{}"). */
function formatSupabaseLikeError(error: unknown): string {
  if (error == null) {
    return '(null/undefined)';
  }
  if (typeof error === 'string') {
    return error;
  }
  if (typeof error !== 'object') {
    return String(error);
  }
  const obj = error as Record<string, unknown>;
  const parts: string[] = [];
  const msg =
    (typeof obj.message === 'string' && obj.message) ||
    (error instanceof Error ? error.message : '');
  if (msg) parts.push(`message=${msg}`);
  if (obj.code != null && String(obj.code) !== '') parts.push(`code=${String(obj.code)}`);
  if (obj.details != null && String(obj.details) !== '') parts.push(`details=${String(obj.details)}`);
  if (obj.hint != null && String(obj.hint) !== '') parts.push(`hint=${String(obj.hint)}`);
  const status = obj.status ?? obj.statusCode;
  if (typeof status === 'number' || (typeof status === 'string' && status !== '')) {
    parts.push(`status=${String(status)}`);
  }
  if (parts.length > 0) {
    return parts.join(' | ');
  }
  try {
    const keys = Object.getOwnPropertyNames(obj);
    if (keys.length > 0) {
      return keys.map((k) => `${k}=${String(obj[k])}`).join(', ');
    }
  } catch {
    /* ignore */
  }
  try {
    return `json=${JSON.stringify(obj)}`;
  } catch {
    /* ignore */
  }
  const s = String(error);
  return s === '[object Object]' ? '(empty error object)' : s;
}

type AuthContextType = {
  isAuthenticated: boolean;
  isLoading: boolean;
  userProfile: UserProfile | null;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const supabase = useSupabase();
  const queryClient = useQueryClient();
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  
  const profileFetchInProgress = useRef<boolean>(false);
  const currentUserId = useRef<string | null>(null);
  const loadedProfileUserId = useRef<string | null>(null);

  const setStableUserProfile = useCallback((profile: UserProfile | null) => {
    loadedProfileUserId.current = profile?.id ?? null;
    setUserProfile((currentProfile) =>
      areUserProfilesEqual(currentProfile, profile) ? currentProfile : profile
    );
  }, []);

  const fetchUserProfile = useCallback(async (userId: string): Promise<void> => {
    // Skip only if already in progress
    if (profileFetchInProgress.current) {
      return;
    }

    profileFetchInProgress.current = true;
    currentUserId.current = userId;

    const loadProfile = async () =>
      supabase.from('profiles').select('*').eq('id', userId).single();

    try {
      let result = await loadProfile();
      for (let attempt = 0; shouldRetryProfileFetch(result, attempt); attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
        result = await loadProfile();
      }
      let { data: profile, error } = result;

      // PGRST303 = JWT iat is ahead of PostgREST's clock (common after WSL/Docker
      // sleep/resume drift). Refresh once so Auth re-issues a token with a current iat.
      if (error?.code === 'PGRST303') {
        const { error: refreshError } = await supabase.auth.refreshSession();
        if (!refreshError) {
          ({ data: profile, error } = await loadProfile());
        }
      }

      if (error) {
        // If profile doesn't exist, try to create it automatically
        if (error.code === 'PGRST116') { // PGRST116 = no rows returned
          // Get user email from auth.users
          const { data: { user }, error: userError } = await supabase.auth.getUser();
          
          if (!userError && user && user.id === userId) {
            // Try to create profile automatically
            const { data: newProfile, error: insertError } = await supabase
              .from('profiles')
              .insert({
                id: userId,
                email: user.email || '',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
              })
              .select()
              .single();
            
            if (!insertError && newProfile) {
              setStableUserProfile(newProfile);
              profileFetchInProgress.current = false;
              return;
            }
          }
          // Reset currentUserId to allow retry
          currentUserId.current = null;
        } else {
          // Only log non-PGRST116 errors (PGRST116 = no rows returned, which is expected for new users).
          if (error.code === 'PGRST303') {
            console.warn(
              `Failed to fetch profile (clock skew / stale JWT): ${formatSupabaseLikeError(error)}. ` +
                'Sign out and sign back in, or sync Windows/WSL time if this persists.'
            );
          } else {
            console.error(`Failed to fetch profile: ${formatSupabaseLikeError(error)}`);
          }
          // Reset currentUserId to allow retry
          currentUserId.current = null;
        }
        setStableUserProfile(null);
      } else if (profile) {
        setStableUserProfile(profile);
      } else {
        // Reset currentUserId to allow retry
        currentUserId.current = null;
        setStableUserProfile(null);
      }
    } catch (err) {
      console.error(`Failed to fetch profile (exception): ${formatSupabaseLikeError(err)}`);
      // Reset currentUserId to allow retry
      currentUserId.current = null;
      setStableUserProfile(null);
    } finally {
      profileFetchInProgress.current = false;
    }
  }, [setStableUserProfile, supabase]);

  const signOut = useCallback(async () => {
    try {
      await supabase.auth.signOut();
      setIsAuthenticated(false);
      setStableUserProfile(null);
      currentUserId.current = null;
      
      // Clear all caches when user signs out
      clearAllCaches(queryClient);
      
      // Clear pending invitation token to prevent issues when switching accounts
      if (typeof window !== 'undefined') {
        sessionStorage.removeItem('pendingInvitationToken');
      }
    } catch (e) {
      console.error('Logout failed', e);
    }
  }, [setStableUserProfile, supabase, queryClient]);

  useEffect(() => {
    let mounted = true;
    let initializationComplete = false;

    setIsLoading(true);
    setIsAuthenticated(false);
    setStableUserProfile(null);

    // On initial mount, try to restore session from cookies
    const initializeAuth = async () => {
      if (!mounted) return;
      
      try {
        // Try to get existing session
        const { data: { session }, error } = await supabase.auth.getSession();
        
        if (mounted) {
        
          if (session?.user && !error) {
            setIsAuthenticated(true);
            currentUserId.current = session.user.id;
            // delete await
            void fetchUserProfile(session.user.id);
          } else {
            setIsAuthenticated(false);
            setStableUserProfile(null);
            currentUserId.current = null;
          }
        }
      } catch (err) {
        console.error('Failed to initialize auth session:', err);
        if (mounted) {
          setIsAuthenticated(false);
          setStableUserProfile(null);
          currentUserId.current = null;
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
          initializationComplete = true;
        }
      }
    };

    // Initialize auth state immediately
    initializeAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!mounted) return;

      // If initialization is not complete yet, let initializeAuth handle it
      if (!initializationComplete && event === 'INITIAL_SESSION') {
        return;
      }

      try {
        const prevUserId = currentUserId.current;
        
        if (session?.user) {
          setIsAuthenticated(true);
          const newUserId = session.user.id;
          const shouldFetchProfile = shouldFetchUserProfileForAuthEvent(
            event,
            newUserId,
            currentUserId.current,
            loadedProfileUserId.current
          );
          
          // If user changed (not just initial load), clear caches
          if (currentUserId.current !== null && currentUserId.current !== newUserId) {
            clearAllCaches(queryClient);
          }
          
          // Set currentUserId to null first when user changes, then set to new value
          // This ensures all dependent code can properly detect user switch
          if (currentUserId.current !== newUserId) {
            currentUserId.current = null;
          }
          currentUserId.current = newUserId;
          if (shouldFetchProfile) {
            void fetchUserProfile(newUserId);
          }
        } else {
          // User signed out or no session
          // Clear caches if there was a previous user
          if (prevUserId !== null) {
            clearAllCaches(queryClient);
          }
          
          setIsAuthenticated(false);
          setStableUserProfile(null);
          currentUserId.current = null;
        }
      } catch (err) {
        console.error('Auth state change failed:', err);
        setIsAuthenticated(false);
        setStableUserProfile(null);
        currentUserId.current = null;
      } finally {
        // Ensure loading is false after any auth state change
        if (mounted) {
          setIsLoading(false);
        }
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [fetchUserProfile, setStableUserProfile, supabase, queryClient]);

  const value = useMemo<AuthContextType>(() => ({
    isAuthenticated,
    isLoading,
    userProfile,
    signOut,
  }), [isAuthenticated, isLoading, signOut, userProfile]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
