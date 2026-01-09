/**
 * Collaboration Service
 * 
 * Core business logic for managing project collaborators and invitations.
 * Handles database operations for collaboration features.
 * 
 * NOTE: Most operations should be called from Server Actions with user auth.
 * Service role is only used for specific operations like invitation acceptance.
 */

import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  CollaboratorRole,
  Collaborator,
  PendingInvitation,
  SendInvitationInput,
  SendInvitationOutput,
  GetCollaboratorsOutput,
} from '@/lib/types/collaboration';
import { generateInvitationToken } from '@/lib/utils/invitationToken';
import { sendInvitationEmail } from '@/lib/services/emailService';

/**
 * Create Supabase client with service role for admin operations
 * ONLY use for operations that need to bypass RLS (like invitation acceptance)
 */
function getServiceClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  
  return createClient(supabaseUrl, supabaseServiceRole, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    }
  });
}

/**
 * Send invitation to collaborate on a project
 * 
 * @param supabase - Supabase client with user auth (NOT service role)
 * @param input - Invitation details (projectId, email, role)
 * @param inviterId - User ID of inviter (must be admin)
 * @param inviterName - Display name of inviter
 * @param projectName - Name of project for email template
 * @returns Success status and invitation ID or error
 * 
 * Business Rules:
 * - Only project owners can invite via RLS (admins use Server Actions)
 * - Cannot invite existing collaborators (duplicate check)
 * - Inviter's role must allow inviting with specified role
 * - Generates JWT token with 7-day expiration
 * - Sends email with accept link
 */
export async function sendInvitation(
  supabase: SupabaseClient,
  input: SendInvitationInput,
  inviterId: string,
  inviterName: string,
  projectName: string
): Promise<SendInvitationOutput> {
  const { projectId, recipientEmail, role } = input;
  
  try {
    
    // 1. Check if recipient email already has a user account and is a collaborator
    // First, try to find user by email
    const { data: recipientProfile } = await supabase
      .from('profiles')
      .select('id')
      .eq('email', recipientEmail.toLowerCase())
      .maybeSingle();
    
    if (recipientProfile) {
      // User exists, check if already a collaborator
      const { data: existingCollaborator } = await supabase
        .from('project_collaborators')
        .select('id')
        .eq('project_id', projectId)
        .eq('user_id', recipientProfile.id)
        .not('accepted_at', 'is', null)
        .maybeSingle();
      
      if (existingCollaborator) {
        return { success: false, error: 'This user is already a collaborator on this project' };
      }
    }
    
    // 2. Check for pending invitation to same email+project
    const { data: existingInvitation } = await supabase
      .from('collaboration_invitations')
      .select('id, accepted_at')
      .eq('project_id', projectId)
      .eq('recipient_email', recipientEmail.toLowerCase())
      .is('accepted_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    
    if (existingInvitation) {
      return { 
        success: false, 
        error: 'An invitation has already been sent to this email address' 
      };
    }
    
    // 3. Generate JWT token BEFORE creating invitation
    // Create a temporary ID for token generation
    const tempInvitationId = crypto.randomUUID();
    let token: string;
    try {
      token = await generateInvitationToken({
        invitationId: tempInvitationId,
        projectId,
        email: recipientEmail.toLowerCase(),
        role,
      });
    } catch (tokenError) {
      console.error('Error generating token:', tokenError);
      return { success: false, error: 'Failed to generate invitation token' };
    }
    
    // 4. Create invitation record with token (RLS will check inviter permissions)
    const { data: invitation, error: insertError } = await supabase
      .from('collaboration_invitations')
      .insert({
        id: tempInvitationId,
        project_id: projectId,
        recipient_email: recipientEmail.toLowerCase(),
        role,
        invited_by: inviterId,
        invitation_token: token,
      })
      .select('id')
      .single();
    
    if (insertError || !invitation) {
      console.error('Error creating invitation:', insertError);
      return { 
        success: false, 
        error: insertError?.message || 'Failed to create invitation' 
      };
    }
    
    // 5. Send email
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const acceptLink = `${appUrl}/accept-invitation?token=${token}`;
    
    // TODO: Email sending temporarily disabled for UI testing
    // Uncomment when email service is configured (RESEND_API_KEY set)
    console.log('[sendInvitation] Email sending disabled. Accept link:', acceptLink);
    
    /* 
    try {
      await sendInvitationEmail({
        recipientEmail,
        inviterName,
        projectName,
        role: role.charAt(0).toUpperCase() + role.slice(1), // Capitalize role
        acceptLink,
      });
    } catch (emailError) {
      console.error('Error sending invitation email:', emailError);
      return { 
        success: false, 
        error: 'Invitation created but email failed to send. Please try resending.' 
      };
    }
    */
    
    return { success: true, invitationId: invitation.id };
  } catch (error) {
    console.error('Unexpected error in sendInvitation:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'An unexpected error occurred' 
    };
  }
}

/**
 * Get all collaborators and pending invitations for a project
 * 
 * @param supabase - Supabase client with user auth
 * @param projectId - Project ID
 * @param userId - Current user ID (for permission check)
 * @returns Collaborators and pending invitations
 */
export async function getProjectCollaborators(
  supabase: SupabaseClient,
  projectId: string,
  userId: string
): Promise<GetCollaboratorsOutput> {
  
  try {
    // 1. Get current user's role to determine what they can see
    const { data: userRole } = await supabase
      .from('project_collaborators')
      .select('role')
      .eq('project_id', projectId)
      .eq('user_id', userId)
      .not('accepted_at', 'is', null)
      .single();
    
    if (!userRole) {
      throw new Error('User is not a collaborator on this project');
    }
    
    // 2. Get all collaborators
    const { data: collaboratorsData, error: collaboratorsError } = await supabase
      .from('project_collaborators')
      .select(`
        id,
        user_id,
        role,
        invited_by,
        invited_at,
        accepted_at,
        profiles:user_id (
          name,
          email,
          avatar_color
        ),
        inviter:invited_by (
          name
        )
      `)
      .eq('project_id', projectId)
      .not('accepted_at', 'is', null)
      .order('role', { ascending: true }) // Admin first
      .order('created_at', { ascending: true });
    
    if (collaboratorsError) {
      console.error('Error fetching collaborators:', collaboratorsError);
      throw collaboratorsError;
    }
    
    // 3. Get pending invitations (admins only)
    let pendingInvitations: PendingInvitation[] = [];
    if (userRole.role === 'admin') {
      const { data: invitationsData, error: invitationsError } = await supabase
        .from('collaboration_invitations')
        .select(`
          id,
          recipient_email,
          role,
          invited_by,
          invited_at,
          expires_at,
          profiles:invited_by (
            name
          )
        `)
        .eq('project_id', projectId)
        .is('accepted_at', null)
        .order('invited_at', { ascending: false });
      
      if (!invitationsError && invitationsData) {
        pendingInvitations = invitationsData.map((inv: any) => ({
          id: inv.id,
          recipientEmail: inv.recipient_email,
          role: inv.role,
          invitedBy: inv.invited_by,
          inviterName: inv.profiles?.name || 'Unknown',
          invitedAt: inv.invited_at,
          expiresAt: inv.expires_at,
        }));
      }
    }
    
    // 4. Transform collaborators data
    const collaborators: Collaborator[] = collaboratorsData.map((collab: any) => ({
      id: collab.id,
      userId: collab.user_id,
      userName: collab.profiles?.name || 'Unknown User',
      userEmail: collab.profiles?.email || '',
      avatarColor: collab.profiles?.avatar_color || '#999999',
      role: collab.role,
      invitedBy: collab.invited_by,
      invitedByName: collab.inviter?.name || null,
      invitedAt: collab.invited_at,
      acceptedAt: collab.accepted_at,
      lastActiveAt: null, // TODO: Implement presence tracking in User Story 4
    }));
    
    return { collaborators, pendingInvitations };
  } catch (error) {
    console.error('Error in getProjectCollaborators:', error);
    throw error;
  }
}

/**
 * Accept invitation and add user as collaborator
 * 
 * @param invitationId - Invitation ID from token
 * @param userId - User ID accepting invitation
 * @param userEmail - User's email address
 * @returns Success status with project details or error
 */
export async function acceptInvitation(
  invitationId: string,
  userId: string,
  userEmail: string
): Promise<{ success: boolean; projectId?: string; projectName?: string; error?: string }> {
  const supabase = getServiceClient();
  
  try {
    // 1. Get invitation details
    const { data: invitation, error: invitationError } = await supabase
      .from('collaboration_invitations')
      .select('*, projects:project_id(name)')
      .eq('id', invitationId)
      .single();
    
    if (invitationError || !invitation) {
      return { success: false, error: 'Invitation not found' };
    }
    
    // 2. Validate invitation status
    if (invitation.accepted_at) {
      return { success: false, error: 'Invitation has already been accepted' };
    }
    
    // 3. Check expiration
    const now = new Date();
    const expiresAt = new Date(invitation.expires_at);
    if (now > expiresAt) {
      return { success: false, error: 'Invitation has expired' };
    }
    
    // 4. Validate email matches (case-insensitive)
    if (invitation.recipient_email.toLowerCase() !== userEmail.toLowerCase()) {
      return { 
        success: false, 
        error: 'This invitation was sent to a different email address' 
      };
    }
    
    // 5. Check if user already collaborator
    const { data: existingCollab } = await supabase
      .from('project_collaborators')
      .select('id')
      .eq('project_id', invitation.project_id)
      .eq('user_id', userId)
      .single();
    
    if (existingCollab) {
      // Mark invitation as accepted even though user was already added
      await supabase
        .from('collaboration_invitations')
        .update({ accepted_at: new Date().toISOString(), accepted_by: userId })
        .eq('id', invitationId);
      
      return { 
        success: true, 
        projectId: invitation.project_id,
        projectName: invitation.projects?.name || 'Unknown Project',
      };
    }
    
    // 6. Add user as collaborator
    const { error: collaboratorError } = await supabase
      .from('project_collaborators')
      .insert({
        user_id: userId,
        project_id: invitation.project_id,
        role: invitation.role,
        invited_by: invitation.invited_by,
        invited_at: invitation.invited_at,
        accepted_at: new Date().toISOString(),
      });
    
    if (collaboratorError) {
      console.error('Error adding collaborator:', collaboratorError);
      return { success: false, error: 'Failed to add collaborator' };
    }
    
    // 7. Mark invitation as accepted
    const { error: updateError } = await supabase
      .from('collaboration_invitations')
      .update({ 
        accepted_at: new Date().toISOString(),
        accepted_by: userId,
      })
      .eq('id', invitationId);
    
    if (updateError) {
      console.error('Error updating invitation status:', updateError);
      // Don't fail the acceptance - collaborator was already added
    }
    
    return { 
      success: true, 
      projectId: invitation.project_id,
      projectName: invitation.projects?.name || 'Unknown Project',
    };
  } catch (error) {
    console.error('Unexpected error in acceptInvitation:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'An unexpected error occurred' 
    };
  }
}

/**
 * Get user's role in a project
 * 
 * @param supabase - Supabase client with user auth
 * @param projectId - Project ID
 * @param userId - User ID
 * @returns User's role and owner status
 */
export async function getUserProjectRole(
  supabase: SupabaseClient,
  projectId: string,
  userId: string
): Promise<{ role: CollaboratorRole | null; isOwner: boolean }> {
  
  try {
    // Check if user is project owner
    const { data: project } = await supabase
      .from('projects')
      .select('owner_id')
      .eq('id', projectId)
      .single();
    
    const isOwner = project?.owner_id === userId;
    
    // Get user's collaborator role
    const { data: collaborator } = await supabase
      .from('project_collaborators')
      .select('role')
      .eq('project_id', projectId)
      .eq('user_id', userId)
      .not('accepted_at', 'is', null)
      .single();
    
    return {
      role: collaborator?.role || null,
      isOwner,
    };
  } catch (error) {
    console.error('Error getting user project role:', error);
    return { role: null, isOwner: false };
  }
}

