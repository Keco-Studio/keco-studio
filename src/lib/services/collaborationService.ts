/**
 * Collaboration Service
 * 
 * Core business logic for managing project collaborators and invitations.
 * Handles database operations for collaboration features.
 * 
 * NOTE: Most operations should be called from Server Actions with user auth.
 * Service-role operations are isolated in API route server modules.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  CollaboratorRole,
  Collaborator,
  PendingInvitation,
  SendInvitationInput,
  GetCollaboratorsOutput,
} from '@/lib/types/collaboration';
import { generateInvitationToken } from '@/lib/utils/invitationToken';
import { sendInvitationEmail } from '@/lib/services/emailService';

export type CollaborationServiceErrorCode =
  | 'SELF_INVITATION'
  | 'ALREADY_COLLABORATOR'
  | 'INVITATION_PENDING'
  | 'TOKEN_GENERATION_FAILED'
  | 'INVITATION_CREATE_FAILED'
  | 'EMAIL_DELIVERY_FAILED'
  | 'UNEXPECTED';

export class CollaborationServiceError extends Error {
  constructor(
    public readonly code: CollaborationServiceErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'CollaborationServiceError';
  }
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
): Promise<string> {
  const { projectId, recipientEmail, role } = input;
  
  try {
    // 0. Get inviter's email to check for self-invitation
    const { data: inviterProfileData } = await supabase
      .from('profiles')
      .select('email')
      .eq('id', inviterId)
      .maybeSingle();
    
    const inviterEmail = inviterProfileData?.email || '';
    
    // Check if user is trying to invite themselves
    if (inviterEmail && inviterEmail.toLowerCase() === recipientEmail.toLowerCase()) {
      throw new CollaborationServiceError('SELF_INVITATION', 'Cannot invite yourself');
    }
    
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
        throw new CollaborationServiceError('ALREADY_COLLABORATOR', 'User already exists');
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
      throw new CollaborationServiceError(
        'INVITATION_PENDING',
        'An invitation has already been sent to this email address'
      );
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
      throw new CollaborationServiceError(
        'TOKEN_GENERATION_FAILED',
        'Failed to generate invitation token'
      );
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
      throw new CollaborationServiceError(
        'INVITATION_CREATE_FAILED',
        'Failed to create invitation'
      );
    }
    
    // 5. Send email (inviterEmail already fetched at the beginning)
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const acceptLink = `${appUrl}/accept-invitation?token=${token}`;
    
    try {
      await sendInvitationEmail({
        recipientEmail,
        inviterName,
        inviterEmail,
        projectName,
        role: role.charAt(0).toUpperCase() + role.slice(1), // Capitalize role
        acceptLink,
      });
      console.log('[sendInvitation] Invitation email sent successfully to', recipientEmail);
    } catch (emailError) {
      console.error('Error sending invitation email:', emailError);
      throw new CollaborationServiceError(
        'EMAIL_DELIVERY_FAILED',
        'Invitation created but email failed to send. Please try resending.'
      );
    }

    return invitation.id;
  } catch (error) {
    console.error('Unexpected error in sendInvitation:', error);
    if (error instanceof CollaborationServiceError) throw error;
    throw new CollaborationServiceError('UNEXPECTED', 'Failed to send invitation');
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
