/**
 * Collaboration Server Actions
 * 
 * Next.js Server Actions for collaboration features.
 * All actions run server-side with automatic CSRF protection.
 */

'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase';
import {
  sendInvitation,
  getProjectCollaborators,
  getUserProjectRole,
} from '@/lib/services/collaborationService';
import type {
  SendInvitationInput,
  SendInvitationOutput,
  GetCollaboratorsInput,
  GetCollaboratorsOutput,
  UpdateRoleInput,
  UpdateRoleOutput,
  RemoveCollaboratorInput,
  RemoveCollaboratorOutput,
  GetUserRoleInput,
  GetUserRoleOutput,
} from '@/lib/types/collaboration';
import { canUserInviteWithRole, canUserManageCollaborators } from '@/lib/types/collaboration';

// ============================================================================
// Validation Schemas
// ============================================================================

const SendInvitationSchema = z.object({
  projectId: z.string().uuid('Invalid project ID'),
  recipientEmail: z.string().email('Invalid email address'),
  role: z.enum(['admin', 'editor', 'viewer'], {
    errorMap: () => ({ message: 'Role must be admin, editor, or viewer' }),
  }),
});

const UpdateRoleSchema = z.object({
  collaboratorId: z.string().uuid('Invalid collaborator ID'),
  newRole: z.enum(['admin', 'editor', 'viewer']),
});

const RemoveCollaboratorSchema = z.object({
  collaboratorId: z.string().uuid('Invalid collaborator ID'),
});

// ============================================================================
// Server Actions
// ============================================================================

/**
 * Send collaboration invitation
 * 
 * Requirements:
 * - User must be authenticated
 * - User must be admin of project
 * - User's role must allow inviting with specified role
 * - Email must not already be collaborator
 */
export async function sendCollaborationInvitation(
  input: SendInvitationInput
): Promise<SendInvitationOutput> {
  try {
    // 1. Validate input
    const validated = SendInvitationSchema.safeParse(input);
    if (!validated.success) {
      return { 
        success: false, 
        error: validated.error.errors[0]?.message || 'Invalid input' 
      };
    }
    
    const { projectId, recipientEmail, role } = validated.data;
    
    // 2. Get current user
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return { success: false, error: 'You must be logged in to send invitations' };
    }
    
    // 3. Check user's role and permissions
    const { role: userRole } = await getUserProjectRole(supabase, projectId, user.id);
    
    if (!userRole) {
      return { success: false, error: 'You are not a member of this project' };
    }
    
    if (!canUserInviteWithRole(userRole, role)) {
      return { 
        success: false, 
        error: `${userRole}s cannot invite users as ${role}` 
      };
    }
    
    // 4. Get user and project names for email
    const { data: profile } = await supabase
      .from('profiles')
      .select('name')
      .eq('id', user.id)
      .single();
    
    const { data: project } = await supabase
      .from('projects')
      .select('name')
      .eq('id', projectId)
      .single();
    
    if (!project) {
      return { success: false, error: 'Project not found' };
    }
    
    const inviterName = profile?.name || user.email?.split('@')[0] || 'A team member';
    const projectName = project.name;
    
    // 5. Send invitation via service
    const result = await sendInvitation(
      supabase,
      { projectId, recipientEmail, role },
      user.id,
      inviterName,
      projectName
    );
    
    // 6. Revalidate collaborators page if successful
    if (result.success) {
      revalidatePath(`/[projectId]/collaborators`, 'page');
    }
    
    return result;
  } catch (error) {
    console.error('Error in sendCollaborationInvitation:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'An unexpected error occurred' 
    };
  }
}

/**
 * Get project collaborators and pending invitations
 * 
 * Requirements:
 * - User must be authenticated
 * - User must be collaborator on project
 * - Pending invitations only visible to admins
 */
export async function getProjectCollaboratorsAction(
  input: GetCollaboratorsInput
): Promise<GetCollaboratorsOutput> {
  try {
    const { projectId } = input;
    
    // 1. Get current user
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    console.log('[getProjectCollaboratorsAction] Auth check:', {
      hasUser: !!user,
      userId: user?.id,
      authError: authError?.message,
    });
    
    if (authError || !user) {
      console.error('[getProjectCollaboratorsAction] Not authenticated:', authError);
      // Return empty result instead of throwing to prevent 500 error
      return {
        collaborators: [],
        pendingInvitations: [],
      };
    }
    
    // 2. Check user has access to project
    const { role } = await getUserProjectRole(supabase, projectId, user.id);
    
    console.log('[getProjectCollaboratorsAction] User role:', { userId: user.id, projectId, role });
    
    if (!role) {
      console.warn('[getProjectCollaboratorsAction] User has no role in project');
      // Return empty result instead of throwing
      return {
        collaborators: [],
        pendingInvitations: [],
      };
    }
    
    // 3. Get collaborators via service
    const result = await getProjectCollaborators(supabase, projectId, user.id);
    
    console.log('[getProjectCollaboratorsAction] Success:', {
      collaboratorsCount: result.collaborators.length,
      pendingCount: result.pendingInvitations.length,
    });
    
    return result;
  } catch (error) {
    console.error('[getProjectCollaboratorsAction] Error:', error);
    // Return empty result instead of throwing to prevent 500 error
    return {
      collaborators: [],
      pendingInvitations: [],
    };
  }
}

/**
 * Update collaborator role
 * 
 * Requirements:
 * - User must be authenticated
 * - User must be admin of project
 * - Cannot change own role (prevent lockout)
 */
export async function updateCollaboratorRole(
  input: UpdateRoleInput
): Promise<UpdateRoleOutput> {
  try {
    // 1. Validate input
    const validated = UpdateRoleSchema.safeParse(input);
    if (!validated.success) {
      return { 
        success: false, 
        error: validated.error.errors[0]?.message || 'Invalid input' 
      };
    }
    
    const { collaboratorId, newRole } = validated.data;
    
    // 2. Get current user
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return { success: false, error: 'You must be logged in to update roles' };
    }
    
    // 3. Get collaborator details to check project and user
    const { data: collaborator, error: collabError } = await supabase
      .from('project_collaborators')
      .select('project_id, user_id')
      .eq('id', collaboratorId)
      .single();
    
    if (collabError || !collaborator) {
      return { success: false, error: 'Collaborator not found' };
    }
    
    // 4. Check user is admin
    const { role: userRole } = await getUserProjectRole(supabase, collaborator.project_id, user.id);
    
    if (!canUserManageCollaborators(userRole!)) {
      return { success: false, error: 'Only admins can change collaborator roles' };
    }
    
    // 5. Prevent self-role-change
    if (collaborator.user_id === user.id) {
      return { success: false, error: 'You cannot change your own role' };
    }
    
    // 6. Update role
    const { error: updateError } = await supabase
      .from('project_collaborators')
      .update({ role: newRole, updated_at: new Date().toISOString() })
      .eq('id', collaboratorId);
    
    if (updateError) {
      console.error('Error updating collaborator role:', updateError);
      return { success: false, error: 'Failed to update role' };
    }
    
    // 7. Revalidate collaborators page
    revalidatePath(`/[projectId]/collaborators`, 'page');
    
    return { success: true };
  } catch (error) {
    console.error('Error in updateCollaboratorRole:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'An unexpected error occurred' 
    };
  }
}

/**
 * Remove collaborator from project
 * 
 * Requirements:
 * - User must be authenticated
 * - User must be admin of project
 * - Cannot remove self (prevent lockout)
 * - Cannot remove last admin (prevent orphaned project)
 */
export async function removeCollaborator(
  input: RemoveCollaboratorInput
): Promise<RemoveCollaboratorOutput> {
  try {
    // 1. Validate input
    const validated = RemoveCollaboratorSchema.safeParse(input);
    if (!validated.success) {
      return { 
        success: false, 
        error: validated.error.errors[0]?.message || 'Invalid input' 
      };
    }
    
    const { collaboratorId } = validated.data;
    
    // 2. Get current user
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return { success: false, error: 'You must be logged in to remove collaborators' };
    }
    
    // 3. Get collaborator details
    const { data: collaborator, error: collabError } = await supabase
      .from('project_collaborators')
      .select('project_id, user_id, role')
      .eq('id', collaboratorId)
      .single();
    
    if (collabError || !collaborator) {
      return { success: false, error: 'Collaborator not found' };
    }
    
    // 4. Check user is admin
    const { role: userRole } = await getUserProjectRole(supabase, collaborator.project_id, user.id);
    
    if (!canUserManageCollaborators(userRole!)) {
      return { success: false, error: 'Only admins can remove collaborators' };
    }
    
    // 5. Prevent self-removal
    if (collaborator.user_id === user.id) {
      return { success: false, error: 'You cannot remove yourself from the project' };
    }
    
    // 6. If removing an admin, check there's at least one other admin
    if (collaborator.role === 'admin') {
      const { data: admins, error: adminError } = await supabase
        .from('project_collaborators')
        .select('id')
        .eq('project_id', collaborator.project_id)
        .eq('role', 'admin')
        .not('accepted_at', 'is', null);
      
      if (adminError || !admins || admins.length <= 1) {
        return { 
          success: false, 
          error: 'Cannot remove the last admin. Promote another user to admin first.' 
        };
      }
    }
    
    // 7. Remove collaborator
    const { error: deleteError } = await supabase
      .from('project_collaborators')
      .delete()
      .eq('id', collaboratorId);
    
    if (deleteError) {
      console.error('Error removing collaborator:', deleteError);
      return { success: false, error: 'Failed to remove collaborator' };
    }
    
    // 8. Revalidate collaborators page
    revalidatePath(`/[projectId]/collaborators`, 'page');
    
    return { success: true };
  } catch (error) {
    console.error('Error in removeCollaborator:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'An unexpected error occurred' 
    };
  }
}

/**
 * Get current user's role in a project
 * 
 * Requirements:
 * - User must be authenticated
 * - Returns null if user is not a collaborator
 */
export async function getUserProjectRoleAction(
  input: GetUserRoleInput
): Promise<GetUserRoleOutput> {
  try {
    const { projectId } = input;
    
    // 1. Get current user
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return { role: null, isOwner: false };
    }
    
    // 2. Get role via service
    const result = await getUserProjectRole(supabase, projectId, user.id);
    
    return result;
  } catch (error) {
    console.error('Error in getUserProjectRoleAction:', error);
    return { role: null, isOwner: false };
  }
}

