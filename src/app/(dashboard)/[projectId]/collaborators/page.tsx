/**
 * Collaborators Page
 * 
 * Manage project collaborators and invitations.
 * Features:
 * - View all collaborators with roles
 * - Invite new collaborators (admins only)
 * - View pending invitations (admins only)
 * - Role-based UI (admin/editor/viewer)
 * - Real-time updates for collaborator changes
 * - Optimistic UI updates with rollback
 */

'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSupabase } from '@/lib/SupabaseContext';
import { queryKeys } from '@/lib/utils/queryKeys';
import Image from 'next/image';
import CollaboratorsList from '@/components/collaboration/CollaboratorsList';
import { InviteCollaboratorModal } from '@/components/collaboration/InviteCollaboratorModal';
import { showSuccessToast } from '@/lib/utils/toast';
import type { Collaborator } from '@/lib/types/collaboration';
import { getUserAvatarColor } from '@/lib/utils/avatarColors';
import collaborationReturnIcon from '@/assets/images/collaborationReturnIcon.svg';
import collaborationAdminNumIcon from '@/assets/images/collaborationAdminNumIcon.svg';
import collaborationEditNumIcon from '@/assets/images/collaborationEditNumIcon.svg';
import collaborationViewNumIcon from '@/assets/images/collaborationViewNumIcon.svg';
import searchIcon from '@/assets/images/searchIcon.svg';
import libraryHeadMoreIcon from '@/assets/images/libraryHeadMoreIcon.svg';
import styles from './page.module.css';

export default function CollaboratorsPage() {
  const params = useParams();
  const router = useRouter();
  const supabase = useSupabase();
  const queryClient = useQueryClient();
  const projectId = params.projectId as string;
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [projectName, setProjectName] = useState<string>('');
  const [userRole, setUserRole] = useState<'admin' | 'editor' | 'viewer' | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string>('');
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const [highlightUserId, setHighlightUserId] = useState<string | null>(null);
  
  // Fetch data function (can be called to refresh)
  // Returns the updated collaborators list for immediate use
  const fetchData = useCallback(async (): Promise<Collaborator[]> => {
    // Validate projectId is a valid UUID
    if (!projectId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectId)) {
      console.error('[CollaboratorsPage] Invalid project ID:', projectId);
      setError('Invalid project ID');
      setLoading(false);
      router.push('/projects');
      return [];
    }
    
    setLoading(true);
    setError(null);
    
    try {
      
      // 1. Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setError('You must be logged in to view this page');
        setLoading(false);
        return;
      }
      setCurrentUserId(user.id);
      
      // 2. Get project details
      const { data: project, error: projectError } = await supabase
        .from('projects')
        .select('name, owner_id')
        .eq('id', projectId)
        .single();
      
      if (projectError) {
        console.error('[CollaboratorsPage] Error fetching project:', projectError);
        setError('Failed to load project: ' + projectError.message);
      } else if (project) {
        setProjectName(project.name);
        
        // Check if current user is owner
        if (user && project.owner_id === user.id) {
          setIsOwner(true);
        }
      }
      
      // 3. Get user role
      try {
        // Get session for authorization
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          console.warn('[CollaboratorsPage] No session found');
          setError('Please log in to view this page');
          setLoading(false);
          return;
        }
        
        const roleResponse = await fetch(`/api/projects/${projectId}/role`, {
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
          },
        });
        const roleResult = await roleResponse.json();
        
        if (roleResult.role) {
          setUserRole(roleResult.role);
          setIsOwner(roleResult.isOwner);
        } else if (roleResult.isOwner) {
          // User is owner but not in collaborators table (shouldn't happen with auto-add)
          setUserRole('admin');
          setIsOwner(true);
          console.warn('[CollaboratorsPage] Owner not in collaborators table, defaulting to admin');
        } else {
          console.warn('[CollaboratorsPage] No role returned and user is not owner');
          setError('You do not have access to this project');
          setLoading(false);
          return;
        }
      } catch (err) {
        console.error('[CollaboratorsPage] Error getting user role:', err);
        setError('Failed to verify your access to this project');
        setLoading(false);
        return;
      }
      
      // 4. Get collaborators and invitations
      // Use direct client query as fallback since sessionStorage auth doesn't work with server actions
      try {
        
        // Query collaborators with profile data (including pending ones)
        const { data: collabData, error: collabError } = await supabase
          .from('project_collaborators')
          .select(`
            id,
            user_id,
            role,
            invited_by,
            invited_at,
            accepted_at,
            created_at,
            updated_at,
            profile:user_id (
              id,
              email,
              username,
              full_name,
              avatar_color,
              avatar_url
            )
          `)
          .eq('project_id', projectId)
          .order('created_at', { ascending: true });
        
        if (collabError) {
          console.error('[CollaboratorsPage] Error fetching collaborators:', collabError);
          throw collabError;
        }
        
        // Transform data to match Collaborator type
        const transformedCollaborators = (collabData || []).map((collab: any) => {
          const email = collab.profile?.email || '';
          const userId = collab.user_id;
          // Always generate color from userId to ensure consistency with TopBar and other components
          const avatarColor = userId ? getUserAvatarColor(userId) : '#94a3b8';
          
          return {
            id: collab.id,
            userId: userId,
            userName: collab.profile?.username || collab.profile?.full_name || email.split('@')[0] || 'User',
            userEmail: email,
            avatarColor: avatarColor,
            role: collab.role,
            invitedBy: collab.invited_by,
            invitedByName: null, // Could fetch inviter profile if needed
            invitedAt: collab.invited_at,
            acceptedAt: collab.accepted_at,
            lastActiveAt: null,
            // Keep aliases for CollaboratorsList component compatibility
            user_id: userId,
            avatar_color: avatarColor,
            profile: collab.profile,
            profiles: collab.profile,
            user_profiles: collab.profile,
          } as any;
        });
        
        // Query pending invitations and convert them to Collaborator format
        let pendingInvitesAsCollaborators: any[] = [];
        
        // Query pending invitations for all users (not just admin)
        const { data: inviteData, error: inviteError } = await supabase
          .from('collaboration_invitations')
          .select(`
            id,
            recipient_email,
            role,
            invited_by,
            sent_at,
            expires_at,
            accepted_at,
            inviter:invited_by (
              username,
              full_name,
              email
            )
          `)
          .eq('project_id', projectId)
          .is('accepted_at', null)
          .order('sent_at', { ascending: false });
        
        
        if (!inviteError && inviteData) {
          // For each pending invitation, try to find the user profile by email
          const pendingEmails = inviteData.map(inv => inv.recipient_email.toLowerCase());
          
          // Query profiles by email to get existing user info
          const { data: profilesData } = await supabase
            .from('profiles')
            .select('id, email, username, full_name, avatar_color, avatar_url')
            .in('email', pendingEmails);
          
          // Create a map of email -> profile for quick lookup
          const emailToProfile = new Map(
            (profilesData || []).map(p => [p.email.toLowerCase(), p])
          );
          
          
          // Convert pending invitations to Collaborator format
          pendingInvitesAsCollaborators = inviteData.map((invite: any) => {
              const email = invite.recipient_email.toLowerCase();
              const profile = emailToProfile.get(email);
              
              // If user profile exists, use their real info; otherwise use email-based fallback
              const userId = profile?.id || null;
              const userName = profile?.username || profile?.full_name || email.split('@')[0];
              // Always generate color from userId (if exists) to ensure consistency, fallback to email for unregistered users
              const avatarColor = userId ? getUserAvatarColor(userId) : getUserAvatarColor(email);
              
              return {
                id: `invite-${invite.id}`, // Use a prefix to distinguish from real collaborators
                userId: userId, // Use real user_id if profile exists
                userName: userName, // Use real username or fallback to email part
                userEmail: email,
                avatarColor: avatarColor, // Use profile color or generate from userId/email
                role: invite.role,
                invitedBy: invite.invited_by,
                invitedByName: invite.inviter?.username || invite.inviter?.full_name || invite.inviter?.email || 'Unknown',
                invitedAt: invite.sent_at,
                acceptedAt: null, // This marks it as pending
                lastActiveAt: null,
                // Keep aliases for CollaboratorsList component compatibility
                user_id: userId,
                avatar_color: avatarColor,
                profile: profile || null,
                profiles: profile || null,
                user_profiles: profile || null,
              } as any;
            });
          }
        
        
        // Combine accepted collaborators and pending invitations
        const allCollaborators = [...transformedCollaborators, ...pendingInvitesAsCollaborators];
        
        // Sort collaborators: current user first, then others
        allCollaborators.sort((a, b) => {
          // Current user always comes first
          if (a.userId === user.id) return -1;
          if (b.userId === user.id) return 1;
          // Others sorted by invited_at (earliest first)
          return new Date(a.invitedAt).getTime() - new Date(b.invitedAt).getTime();
        });
        
        setCollaborators(allCollaborators);
        // Also update React Query cache for real-time updates
        queryClient.setQueryData(
          queryKeys.projectCollaborators(projectId),
          allCollaborators
        );
        setLoading(false);
        return allCollaborators; // Return the new data
      } catch (err: any) {
        console.error('[CollaboratorsPage] Error loading collaborators:', err);
        setError(err.message || 'Failed to load collaborators');
        setLoading(false);
        return [];
      }
    } catch (err: any) {
      console.error('[CollaboratorsPage] Error loading collaborators page:', err);
      setError(err.message || 'Failed to load page');
      setLoading(false);
      return [];
    }
  }, [projectId, supabase, router, queryClient]);
  
  // Initial data fetch
  useEffect(() => {
    if (projectId) {
      fetchData();
    }
  }, [projectId, fetchData]);
  
  // Read from React Query cache for real-time updates
  // Provide queryFn (required by React Query) - it will only run if cache is empty
  const { data: cachedCollaborators } = useQuery<Collaborator[]>({
    queryKey: queryKeys.projectCollaborators(projectId),
    queryFn: async () => collaborators, // Fallback to state if cache is empty
    initialData: collaborators, // Use current state as initial data
    staleTime: Infinity, // Don't refetch automatically
    refetchOnMount: false, // Don't refetch on mount
    refetchOnWindowFocus: false, // Don't refetch on window focus
  });
  
  // Use cached data if available (updated by mutations), otherwise use state
  const displayCollaborators = cachedCollaborators || collaborators;
  
  // Calculate role counts - ONLY include accepted collaborators (exclude pending invites)
  // Must be before any conditional returns to follow Rules of Hooks
  const acceptedCollaborators = useMemo(
    () => displayCollaborators.filter(c => c.acceptedAt !== null),
    [displayCollaborators]
  );
  
  const adminCount = acceptedCollaborators.filter(c => c.role === 'admin').length;
  const editorCount = acceptedCollaborators.filter(c => c.role === 'editor').length;
  const viewerCount = acceptedCollaborators.filter(c => c.role === 'viewer').length;
  
  if (loading) {
    return (
      <div className={styles.loadingContainer}>
        <div className={styles.loadingText}>Loading collaborators...</div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {/* Page Header - All in one row */}
      <div className={styles.pageHeader}>
        {/* Return Button */}
        <button
          onClick={() => router.push(`/${projectId}`)}
          className={styles.returnButton}
          aria-label="Return to project"
        >
          <Image src={collaborationReturnIcon}
            alt="Return"
            width={32} height={32} className="icon-32"
          />
        </button>
        
        {/* Title */}
        <h1 className={styles.pageTitle}>
          Collaborators
        </h1>
        
        {/* Role Statistics */}
        <div className={styles.roleStats}>
          {/* Admin Count */}
          <div className={styles.roleStatItem}>
            <Image src={collaborationAdminNumIcon}
              alt="Admin"
              width={24} height={24} className="icon-24"
            />
            <span className={`${styles.roleStatCount} ${styles.adminCount}`}>
              {adminCount}
            </span>
          </div>
          
          {/* Editor Count */}
          <div className={styles.roleStatItem}>
            <Image src={collaborationEditNumIcon}
              alt="Editor"
              width={24} height={24} className="icon-24"
            />
            <span className={`${styles.roleStatCount} ${styles.editorCount}`}>
              {editorCount}
            </span>
          </div>
          
          {/* Viewer Count */}
          <div className={styles.roleStatItem}>
            <Image src={collaborationViewNumIcon}
              alt="Viewer"
              width={24} height={24} className="icon-24"
            />
            <span className={`${styles.roleStatCount} ${styles.viewerCount}`}>
              {viewerCount}
            </span>
          </div>
        </div>
        
        {/* Invite Button */}
        {userRole && (
          <button
            onClick={() => setInviteModalOpen(true)}
            className={styles.inviteButton}
          >
            Invite
          </button>
        )}
        
        {/* More Options Icon */}
        <button
          className={styles.moreButton}
          aria-label="More options"
        >
          <Image src={libraryHeadMoreIcon}
            alt="More"
            width={32} height={32} className="icon-32"
          />
        </button>
      </div>
      
      {/* Error Banner */}
      {error && (
        <div className={styles.errorBanner}>
          {error}
        </div>
      )}
      
      {/* Collaborators List */}
      {userRole && currentUserId ? (
        <CollaboratorsList
          projectId={projectId}
          collaborators={displayCollaborators}
          currentUserId={currentUserId}
          currentUserRole={userRole}
          onUpdate={fetchData}
          highlightUserId={highlightUserId}
        />
      ) : (
        <div className={styles.emptyState}>
          Loading member information...
        </div>
      )}
      
      {/* Invite Collaborator Modal */}
      {userRole && (
        <InviteCollaboratorModal
          projectId={projectId}
          projectName={projectName}
          userRole={userRole}
          open={inviteModalOpen}
          onClose={() => setInviteModalOpen(false)}
          onSuccess={async (invitedEmail: string, message: string, autoAccepted: boolean) => {
            // Show success message using custom toast
            showSuccessToast(message);
            
            // Refresh data and get the updated list
            const updatedCollaborators = await fetchData();
            // Find the newly invited user by email in the fresh data
            if (invitedEmail && updatedCollaborators) {
              const newCollaborator = updatedCollaborators.find(c => 
                c.userEmail.toLowerCase() === invitedEmail.toLowerCase()
              );
              if (newCollaborator) {
                // Highlight the newly invited user
                setHighlightUserId(newCollaborator.userId);
              }
            }
          }}
          title="Invite new collaborator"
        />
      )}
    </div>
  );
}

