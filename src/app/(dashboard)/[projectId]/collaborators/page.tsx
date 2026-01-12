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

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSupabase } from '@/lib/SupabaseContext';
import CollaboratorsList from '@/components/collaboration/CollaboratorsList';
import { InviteCollaboratorModal } from '@/components/collaboration/InviteCollaboratorModal';
import type { Collaborator, PendingInvitation } from '@/lib/types/collaboration';

export default function CollaboratorsPage() {
  const params = useParams();
  const router = useRouter();
  const supabase = useSupabase();
  const projectId = params.projectId as string;
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [projectName, setProjectName] = useState<string>('');
  const [userRole, setUserRole] = useState<'admin' | 'editor' | 'viewer' | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string>('');
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [pendingInvitations, setPendingInvitations] = useState<PendingInvitation[]>([]);
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  
  // Fetch data function (can be called to refresh)
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    
    try {
      console.log('[CollaboratorsPage] Loading collaborators page for project:', projectId);
      
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
        console.log('[CollaboratorsPage] Project loaded:', project.name);
        
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
        console.log('[CollaboratorsPage] User role result:', roleResult);
        
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
        console.log('[CollaboratorsPage] Fetching collaborators directly from client');
        
        // Query collaborators with profile data
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
          .not('accepted_at', 'is', null)
          .order('created_at', { ascending: true });
        
        if (collabError) {
          console.error('[CollaboratorsPage] Error fetching collaborators:', collabError);
          throw collabError;
        }
        
        // Transform data to match Collaborator type
        const transformedCollaborators = (collabData || []).map((collab: any) => ({
          id: collab.id,
          userId: collab.user_id,
          userName: collab.profile?.username || collab.profile?.full_name || collab.profile?.email || 'User',
          userEmail: collab.profile?.email || '',
          avatarColor: collab.profile?.avatar_color || '#94a3b8',
          role: collab.role,
          invitedBy: collab.invited_by,
          invitedByName: null, // Could fetch inviter profile if needed
          invitedAt: collab.invited_at,
          acceptedAt: collab.accepted_at,
          lastActiveAt: null,
          // Keep aliases for CollaboratorsList component compatibility
          user_id: collab.user_id,
          avatar_color: collab.profile?.avatar_color || '#94a3b8',
          profile: collab.profile,
          profiles: collab.profile,
          user_profiles: collab.profile,
        } as any));
        
        // Sort collaborators: current user first, then others
        transformedCollaborators.sort((a, b) => {
          // Current user always comes first
          if (a.userId === user.id) return -1;
          if (b.userId === user.id) return 1;
          // Others sorted by created_at (earliest first)
          return new Date(a.invitedAt).getTime() - new Date(b.invitedAt).getTime();
        });
        
        setCollaborators(transformedCollaborators);
        console.log('[CollaboratorsPage] Collaborators loaded:', transformedCollaborators.length);
        
        // Query pending invitations (only if admin)
        if (userRole === 'admin') {
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
            const transformedInvites = inviteData.map((invite: any) => ({
              id: invite.id,
              recipientEmail: invite.recipient_email,
              role: invite.role,
              invitedBy: invite.invited_by,
              inviterName: invite.inviter?.username || invite.inviter?.full_name || invite.inviter?.email || 'Unknown',
              invitedAt: invite.sent_at,
              expiresAt: invite.expires_at,
            }));
            
            setPendingInvitations(transformedInvites);
            console.log('[CollaboratorsPage] Pending invitations:', transformedInvites.length);
          }
        }
      } catch (err: any) {
        console.error('[CollaboratorsPage] Error loading collaborators:', err);
        setError(err.message || 'Failed to load collaborators');
      }
      
      setLoading(false);
    } catch (err: any) {
      console.error('[CollaboratorsPage] Error loading collaborators page:', err);
      setError(err.message || 'Failed to load page');
      setLoading(false);
    }
  }, [projectId, supabase]);
  
  // Initial data fetch
  useEffect(() => {
    if (projectId) {
      fetchData();
    }
  }, [projectId, fetchData]);
  
  if (loading) {
    return (
      <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
        <div style={{ fontSize: '16px', color: '#6b7280' }}>Loading collaborators...</div>
      </div>
    );
  }
  
  return (
    <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
      {/* Page Header */}
      <div style={{ marginBottom: '32px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontSize: '28px', fontWeight: '700', margin: '0 0 8px', color: '#111827' }}>
            Collaborators
          </h1>
          <p style={{ fontSize: '14px', color: '#6b7280', margin: '0' }}>
            Manage who has access to <strong>{projectName || 'this project'}</strong>
          </p>
        </div>
        
        {/* Invite Button (Admin Only) */}
        {userRole === 'admin' && (
          <button
            onClick={() => setInviteModalOpen(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '10px 16px',
              backgroundColor: '#FFB3D9',
              color: '#000000',
              border: 'none',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: '500',
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.backgroundColor = '#FFA0CF';
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.backgroundColor = '#FFB3D9';
            }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M8 3.33334V12.6667M3.33334 8H12.6667" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Invite
          </button>
        )}
      </div>
      
      {/* Error Banner */}
      {error && (
        <div style={{ 
          padding: '16px', 
          backgroundColor: '#fee2e2', 
          color: '#991b1b', 
          borderRadius: '8px',
          border: '1px solid #fecaca',
          marginBottom: '24px',
          fontSize: '14px'
        }}>
          {error}
        </div>
      )}
      
      {/* User Role Info */}
      {userRole && (
        <div style={{ 
          padding: '12px 16px', 
          backgroundColor: '#dbeafe', 
          color: '#1e40af',
          borderRadius: '8px',
          marginBottom: '24px',
          fontSize: '14px',
          fontWeight: '500'
        }}>
          Your role: <strong style={{ textTransform: 'capitalize' }}>{userRole}</strong>
          {isOwner && <span style={{ marginLeft: '8px' }}>(Project Owner)</span>}
        </div>
      )}
      
      {/* Project Members Section */}
      <div style={{ marginBottom: '32px' }}>
        <h2 style={{ fontSize: '20px', fontWeight: '600', marginBottom: '16px', color: '#111827' }}>
          Project Members ({collaborators.length})
        </h2>
        
        {userRole && currentUserId ? (
          <CollaboratorsList
            projectId={projectId}
            collaborators={collaborators}
            currentUserId={currentUserId}
            currentUserRole={userRole}
            onUpdate={fetchData}
          />
        ) : (
          <div style={{ 
            padding: '24px', 
            textAlign: 'center', 
            color: '#6b7280',
            backgroundColor: '#f9fafb',
            borderRadius: '8px',
            border: '1px solid #e5e7eb'
          }}>
            Loading member information...
          </div>
        )}
      </div>
      
      {/* Pending Invitations Section (Admin Only) */}
      {userRole === 'admin' && pendingInvitations.length > 0 && (
        <div style={{ marginBottom: '32px' }}>
          <h2 style={{ fontSize: '20px', fontWeight: '600', marginBottom: '16px', color: '#111827' }}>
            Pending Invitations ({pendingInvitations.length})
          </h2>
          
          <div style={{ 
            backgroundColor: '#ffffff',
            border: '1px solid #e5e7eb',
            borderRadius: '8px',
            overflow: 'hidden'
          }}>
            {pendingInvitations.map((invite) => (
              <div 
                key={invite.id}
                style={{ 
                  padding: '16px', 
                  borderBottom: '1px solid #e5e7eb',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}
              >
                <div>
                  <div style={{ fontWeight: '500', marginBottom: '4px', color: '#111827' }}>
                    {invite.recipientEmail}
                  </div>
                  <div style={{ fontSize: '13px', color: '#6b7280' }}>
                    Invited by {invite.inviterName} • {new Date(invite.invitedAt).toLocaleDateString()}
                  </div>
                </div>
                <div style={{ 
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px'
                }}>
                  <div style={{ 
                    padding: '6px 12px', 
                    backgroundColor: '#fef3c7', 
                    color: '#92400e',
                    borderRadius: '6px',
                    fontSize: '13px',
                    fontWeight: '500',
                    textTransform: 'capitalize'
                  }}>
                    {invite.role}
                  </div>
                  <div style={{ 
                    fontSize: '12px', 
                    color: '#f59e0b',
                    fontWeight: '500'
                  }}>
                    Pending
                  </div>
                </div>
              </div>
            ))}
          </div>
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
          onSuccess={fetchData}
        />
      )}
    </div>
  );
}

