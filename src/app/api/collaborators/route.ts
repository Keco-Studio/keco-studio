/**
 * Collaborators API Routes
 * 
 * Handles collaborator management operations via API routes
 * to properly work with sessionStorage-based authentication.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/createSupabaseServerClient';
import { getUserProjectRole } from '@/lib/services/collaborationService';
import { canUserManageCollaborators } from '@/lib/types/collaboration';

/**
 * GET /api/collaborators?projectId=xxx
 * Get all collaborators and pending invitations for a project
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId');

    if (!projectId) {
      return NextResponse.json(
        { error: 'Project ID is required' },
        { status: 400 }
      );
    }

    // Create Supabase client from request (extracts auth from headers)
    const supabase = createSupabaseServerClient(request);

    // Get current user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json(
        { error: 'You must be logged in' },
        { status: 401 }
      );
    }

    // Check user has access to project
    const { role } = await getUserProjectRole(supabase, projectId, user.id);
    
    if (!role) {
      return NextResponse.json(
        { error: 'You do not have access to this project' },
        { status: 403 }
      );
    }

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
      console.error('[GET /api/collaborators] Error fetching collaborators:', collabError);
      return NextResponse.json(
        { error: 'Failed to load collaborators' },
        { status: 500 }
      );
    }

    // Query pending invitations (only if admin)
    let inviteData = [];
    if (role === 'admin') {
      const { data, error: inviteError } = await supabase
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
      
      if (!inviteError && data) {
        inviteData = data;
      }
    }

    return NextResponse.json({
      collaborators: collabData || [],
      pendingInvitations: inviteData,
    });
  } catch (error) {
    console.error('[GET /api/collaborators] Error:', error);
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}

