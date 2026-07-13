/**
 * Individual Collaborator API Routes
 * 
 * Handles operations on individual collaborators:
 * - PATCH: Update collaborator role
 * - DELETE: Remove collaborator from project
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth, type AuthedRequest } from '@/lib/auth/route-auth';
import {
  AuthorizationError,
  getUserProjectRole,
} from '@/lib/services/authorizationService';
import { canUserManageCollaborators } from '@/lib/types/collaboration';

/**
 * PATCH /api/collaborators/[collaboratorId]
 * Update a collaborator's role
 */
const patchHandler = async (
  request: NextRequest,
  { params }: { params: Promise<{ collaboratorId: string }> },
  { supabase, user }: AuthedRequest
) => {
  try {
    const { collaboratorId } = await params;
    const body = await request.json();
    const { newRole } = body;

    // Validate input
    if (!newRole || !['admin', 'editor', 'viewer'].includes(newRole)) {
      return NextResponse.json(
        { error: 'Valid role is required (admin, editor, or viewer)' },
        { status: 400 }
      );
    }

    // Get collaborator details to check project and user
    const { data: collaborator, error: collabError } = await supabase
      .from('project_collaborators')
      .select('project_id, user_id, role')
      .eq('id', collaboratorId)
      .single();
    
    if (collabError || !collaborator) {
      return NextResponse.json(
        { error: 'Collaborator not found' },
        { status: 404 }
      );
    }

    // Check user is admin
    // SECURITY: Access is determined ONLY by collaborator role
    let userRole;
    try {
      ({ role: userRole } = await getUserProjectRole(
        supabase,
        collaborator.project_id,
        user.id
      ));
    } catch (error) {
      if (!(error instanceof AuthorizationError)) throw error;
      userRole = null;
    }
    
    // User must have a valid role and be able to manage collaborators
    const canManage = userRole && canUserManageCollaborators(userRole);
    
    if (!canManage) {
      return NextResponse.json(
        { error: 'Only admins can change collaborator roles' },
        { status: 403 }
      );
    }

    // Prevent self-role-change
    if (collaborator.user_id === user.id) {
      return NextResponse.json(
        { error: 'You cannot change your own role' },
        { status: 400 }
      );
    }

    // If changing an admin to non-admin, check there's at least one other admin
    if (collaborator.role === 'admin' && newRole !== 'admin') {
      const { data: admins, error: adminError } = await supabase
        .from('project_collaborators')
        .select('id')
        .eq('project_id', collaborator.project_id)
        .eq('role', 'admin')
        .not('accepted_at', 'is', null);
      
      if (adminError || !admins || admins.length <= 1) {
        return NextResponse.json(
          { error: 'Cannot change the last admin. Promote another user to admin first.' },
          { status: 400 }
        );
      }
    }

    // Update role
    const { error: updateError } = await supabase
      .from('project_collaborators')
      .update({ 
        role: newRole, 
        updated_at: new Date().toISOString() 
      })
      .eq('id', collaboratorId);
    
    if (updateError) {
      console.error('[PATCH /api/collaborators] Error updating role:', updateError);
      return NextResponse.json(
        { error: 'Failed to update role' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[PATCH /api/collaborators] Error:', error);
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    );
  }
};

export const PATCH = withAuth(patchHandler, {
  unauthorizedResponse: () => NextResponse.json(
    { error: 'You must be logged in to update roles' },
    { status: 401 }
  ),
});

/**
 * DELETE /api/collaborators/[collaboratorId]
 * Remove a collaborator from the project
 */
const deleteHandler = async (
  request: NextRequest,
  { params }: { params: Promise<{ collaboratorId: string }> },
  { supabase, user }: AuthedRequest
) => {
  try {
    const { collaboratorId } = await params;

    // Get collaborator details
    const { data: collaborator, error: collabError } = await supabase
      .from('project_collaborators')
      .select('project_id, user_id, role')
      .eq('id', collaboratorId)
      .single();
    
    if (collabError || !collaborator) {
      return NextResponse.json(
        { error: 'Collaborator not found' },
        { status: 404 }
      );
    }

    // Check user is admin
    // SECURITY: Access is determined ONLY by collaborator role
    let userRole;
    try {
      ({ role: userRole } = await getUserProjectRole(
        supabase,
        collaborator.project_id,
        user.id
      ));
    } catch (error) {
      if (!(error instanceof AuthorizationError)) throw error;
      userRole = null;
    }
    
    // User must have a valid role and be able to manage collaborators
    const canManage = userRole && canUserManageCollaborators(userRole);
    
    if (!canManage) {
      return NextResponse.json(
        { error: 'Only admins can remove collaborators' },
        { status: 403 }
      );
    }

    // Prevent self-removal
    if (collaborator.user_id === user.id) {
      return NextResponse.json(
        { error: 'You cannot remove yourself from the project' },
        { status: 400 }
      );
    }

    // If removing an admin, check there's at least one other admin
    if (collaborator.role === 'admin') {
      const { data: admins, error: adminError } = await supabase
        .from('project_collaborators')
        .select('id')
        .eq('project_id', collaborator.project_id)
        .eq('role', 'admin')
        .not('accepted_at', 'is', null);
      
      if (adminError || !admins || admins.length <= 1) {
        return NextResponse.json(
          { error: 'Cannot remove the last admin. Promote another user to admin first.' },
          { status: 400 }
        );
      }
    }

    // Remove collaborator
    const { error: deleteError } = await supabase
      .from('project_collaborators')
      .delete()
      .eq('id', collaboratorId);
    
    if (deleteError) {
      console.error('[DELETE /api/collaborators] Error removing:', deleteError);
      return NextResponse.json(
        { error: 'Failed to remove collaborator' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[DELETE /api/collaborators] Error:', error);
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    );
  }
};

export const DELETE = withAuth(deleteHandler, {
  unauthorizedResponse: () => NextResponse.json(
    { error: 'You must be logged in to remove collaborators' },
    { status: 401 }
  ),
});
