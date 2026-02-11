/**
 * Project Layout
 * 
 * Wraps all pages under a specific project to:
 * - Monitor user's role changes in real-time
 * - Auto-refresh page when role changes (viewer ↔ editor ↔ admin)
 * - Auto-redirect to /projects when user is removed from project
 */

'use client';

import { useEffect, useRef } from 'react';
import { useParams, useRouter, usePathname } from 'next/navigation';
import { useSupabase } from '@/lib/SupabaseContext';

export default function ProjectLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const params = useParams();
  const router = useRouter();
  const pathname = usePathname();
  const supabase = useSupabase();
  const projectId = params.projectId as string;
  
  // Ref to track if we're performing a local mutation (to avoid double-refresh)
  const isLocalMutation = useRef(false);
  
  // Ref to store current user ID
  const currentUserIdRef = useRef<string | null>(null);
  
  // Check user access on mount and periodically
  useEffect(() => {
    if (!projectId) return;
    
    const checkUserAccess = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        
        const roleResponse = await fetch(`/api/projects/${projectId}/role`, {
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
          },
        });
        
        if (roleResponse.ok) {
          const roleResult = await roleResponse.json();
          
          // SECURITY FIX: If user has no role in project_collaborators,
          // they have NO access - even if they are the project owner.
          // Access is determined ONLY by collaborator records.
          if (!roleResult.role) {
            console.log('[ProjectLayout] ⚠️ User no longer has access (not in collaborators), redirecting to /projects');
            window.location.href = '/projects';
          }
        }
      } catch (err) {
        console.error('[ProjectLayout] Error checking user access:', err);
      }
    };
    
    // Check immediately on mount
    checkUserAccess();
    
    // Check periodically as fallback (in case real-time subscription fails)
    // Using 60-second interval to reduce unnecessary API calls
    // Real-time subscription (below) handles immediate updates
    const interval = setInterval(checkUserAccess, 60000); // 60 seconds
    
    return () => {
      clearInterval(interval);
    };
  }, [projectId, supabase, router]);
  
  // Real-time subscription for project collaborator changes
  useEffect(() => {
    if (!projectId) return;
    
    let channel: any = null;
    
    const handleCollaboratorChange = (payload: any) => {
      // Skip if this is our own mutation
      if (isLocalMutation.current) {
        isLocalMutation.current = false;
        return;
      }
      
      console.log('[ProjectLayout] Collaborator change detected:', payload);
      
      // Check if the change affects current user
      const currentUserId = currentUserIdRef.current;
      if (!currentUserId) {
        console.log('[ProjectLayout] No current user ID available');
        return;
      }
      
      // For UPDATE events, check if the updated user is current user
      if (payload.eventType === 'UPDATE' && payload.new) {
        const updatedUserId = payload.new.user_id;
        console.log('[ProjectLayout] UPDATE event - updated userId:', updatedUserId, 'current userId:', currentUserId);
        if (updatedUserId === currentUserId) {
          // Current user's role was changed - refresh the page
          console.log('[ProjectLayout] ✅ Current user role changed, refreshing page');
          window.location.reload();
          return;
        }
      }
      
      // For DELETE events, check if deleted user is current user
      if (payload.eventType === 'DELETE' && payload.old) {
        // Find if the deleted collaborator belongs to this project and is current user
        // Since old record only has id, we need to check via broadcast or other means
        // This will be handled by broadcast channel below
      }
    };
    
    const handleBroadcast = (payload: any) => {
      const data = payload.payload;
      const currentUserId = currentUserIdRef.current;
      if (!currentUserId) return;
      
      console.log('[ProjectLayout] Broadcast received:', data);
      
      // If current user's role was changed, refresh page
      if (data?.type === 'role-change' && data?.affectedUserId === currentUserId) {
        console.log('[ProjectLayout] ✅ Current user role changed (broadcast), refreshing page');
        window.location.reload();
        return;
      }
      
      // If current user was removed, redirect to projects page
      if (data?.type === 'delete' && data?.removedUserId === currentUserId) {
        console.log('[ProjectLayout] ⚠️ Current user removed from project (broadcast), redirecting');
        window.location.href = '/projects';
        return;
      }
    };
    
    // Get current user ID first, then set up subscription
    const setupSubscription = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        console.log('[ProjectLayout] No user found, skipping subscription');
        return;
      }
      
      currentUserIdRef.current = user.id;
      console.log('[ProjectLayout] Setting up subscription for user:', user.id, 'project:', projectId);
      
      channel = supabase
        .channel(`project:${projectId}:collaborators`)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'project_collaborators',
            filter: `project_id=eq.${projectId}`,
          },
          handleCollaboratorChange
        )
        .on('broadcast', { event: 'collaborator-change' }, handleBroadcast)
        .subscribe((status) => {
          console.log('[ProjectLayout] Subscription status:', status);
        });
    };
    
    setupSubscription();
    
    // Cleanup function
    return () => {
      if (channel) {
        console.log('[ProjectLayout] Unsubscribing');
        channel.unsubscribe();
      }
    };
  }, [projectId, supabase, router, pathname]);
  
  return <>{children}</>;
}

