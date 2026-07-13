/**
 * Collaborators API Routes
 * 
 * Handles collaborator management operations via API routes
 * to properly work with sessionStorage-based authentication.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/route-auth';
import {
  AuthorizationError,
  getUserProjectRole,
} from '@/lib/services/authorizationService';

/**
 * GET /api/collaborators?projectId=xxx
 * Get all collaborators and pending invitations for a project
 */
export const GET = withAuth(async function GET(
  request: NextRequest,
  _context,
  { supabase, user }
) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId');

    if (!projectId) {
      return NextResponse.json(
        { error: 'Project ID is required' },
        { status: 400 }
      );
    }

    // Check user has access to project
    let role;
    try {
      ({ role } = await getUserProjectRole(supabase, projectId, user.id));
    } catch (error) {
      if (!(error instanceof AuthorizationError)) throw error;
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
    let inviteData: unknown[] = [];
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
}, {
  unauthorizedResponse: () => NextResponse.json(
    { error: 'You must be logged in' },
    { status: 401 }
  ),
});
