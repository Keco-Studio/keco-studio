'use client';

import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { useSupabase } from '@/lib/SupabaseContext';

// Helper function to clear all caches
async function clearAllCaches() {
  // Clear globalRequestCache
  const { globalRequestCache } = await import('@/lib/hooks/useRequestCache');
  globalRequestCache.invalidate();
  
  // Dispatch event to notify components to clear React Query cache
  // Components using useQueryClient will listen to this event
  window.dispatchEvent(new CustomEvent('authStateChanged', { 
    detail: { type: 'signOut' } 
  }));
}

type UserProfile = {
  id: string;
  email: string;
  username: string | null;
  full_name: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
};

type AuthContextType = {
  isAuthenticated: boolean;
  isLoading: boolean;
  userProfile: UserProfile | null;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const supabase = useSupabase();
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  
  const profileFetchInProgress = useRef<boolean>(false);
  const currentUserId = useRef<string | null>(null);

  const fetchUserProfile = useCallback(async (userId: string): Promise<void> => {
    // Skip only if already in progress
    if (profileFetchInProgress.current) {
      return;
    }

    profileFetchInProgress.current = true;
    currentUserId.current = userId;

    try {
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

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
              setUserProfile(newProfile);
              profileFetchInProgress.current = false;
              return;
            }
          }
          // Reset currentUserId to allow retry
          currentUserId.current = null;
        } else {
          // Reset currentUserId to allow retry
          currentUserId.current = null;
        }
        setUserProfile(null);
      } else if (profile) {
        setUserProfile(profile);
      } else {
        // Reset currentUserId to allow retry
        currentUserId.current = null;
        setUserProfile(null);
      }
    } catch (err) {
      // Reset currentUserId to allow retry
      currentUserId.current = null;
      setUserProfile(null);
    } finally {
      profileFetchInProgress.current = false;
    }
  }, [supabase]);

  const signOut = useCallback(async () => {
    try {
      await supabase.auth.signOut();
      setIsAuthenticated(false);
      setUserProfile(null);
      currentUserId.current = null;
      
      // Clear all caches when user signs out
      await clearAllCaches();
      
      // Explicitly clear all auth-related cookies
      if (typeof document !== 'undefined') {
        const cookiesToClear = ['sb-session', 'sb-access-token', 'sb-refresh-token'];
        cookiesToClear.forEach(cookieName => {
          document.cookie = `${cookieName}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
        });
      }
      
      // Clear sessionStorage for this tab
      if (typeof window !== 'undefined') {
        const keysToRemove: string[] = [];
        for (let i = 0; i < sessionStorage.length; i++) {
          const key = sessionStorage.key(i);
          if (key && (key.includes('sb-') || key.includes('supabase'))) {
            keysToRemove.push(key);
          }
        }
        keysToRemove.forEach(key => sessionStorage.removeItem(key));
      }
    } catch (e) {
      console.error('Logout failed', e);
    }
  }, [supabase]);

  useEffect(() => {
    let mounted = true;
    let initializationComplete = false;

    setIsLoading(true);
    setIsAuthenticated(false);
    setUserProfile(null);

    // On initial mount, try to restore session from cookies
    const initializeAuth = async () => {
      if (!mounted) return;
      
      try {
        // Try to get existing session
        const { data: { session }, error } = await supabase.auth.getSession();
        
        if (mounted) {
          if (session?.user && !error) {
            // Session exists, set authenticated state immediately
            setIsAuthenticated(true);
            currentUserId.current = session.user.id;
            await fetchUserProfile(session.user.id);
          } else {
            // No session, ensure we're in unauthenticated state
            setIsAuthenticated(false);
            setUserProfile(null);
            currentUserId.current = null;
          }
        }
      } catch (err) {
        console.error('Failed to initialize auth session:', err);
        if (mounted) {
          setIsAuthenticated(false);
          setUserProfile(null);
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
          
          // If user changed (not just initial load), clear caches
          if (currentUserId.current !== null && currentUserId.current !== newUserId) {
            await clearAllCaches();
          }
          
          currentUserId.current = newUserId;
          await fetchUserProfile(newUserId);
        } else {
          // User signed out or no session
          // Clear caches if there was a previous user
          if (prevUserId !== null) {
            await clearAllCaches();
          }
          
          setIsAuthenticated(false);
          setUserProfile(null);
          currentUserId.current = null;
        }
      } catch (err) {
        console.error('Auth state change failed:', err);
        setIsAuthenticated(false);
        setUserProfile(null);
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
  }, [fetchUserProfile, supabase]);

  const value: AuthContextType = {
    isAuthenticated,
    isLoading,
    userProfile,
    signOut,
  };

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

