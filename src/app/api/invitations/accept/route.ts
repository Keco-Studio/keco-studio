/**
 * Accept Invitation API Route
 * 
 * Handles accepting collaboration invitations.
 * Validates JWT token and adds user as collaborator.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/route-auth';
import { validateInvitationToken } from '@/lib/utils/invitationToken';
import { getSupabaseServiceRoleClient } from '@/lib/server/supabaseServiceRole';

/**
 * POST /api/invitations/accept
 * Accept a collaboration invitation
 */
export const POST = withAuth(async function POST(
  request: NextRequest,
  _context,
  { supabase: userSupabase, user }
) {
  try {
    // Get invitation token from request body
    const body = await request.json();
    const { invitationToken } = body;

    if (!invitationToken) {
      return NextResponse.json(
        { success: false, error: 'Missing invitation token' },
        { status: 400 }
      );
    }

    // Validate invitation token
    let tokenPayload;
    try {
      tokenPayload = await validateInvitationToken(invitationToken);
    } catch (error) {
      console.error('Token validation error:', error);
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid invitation token',
        },
        { status: 400 }
      );
    }

    // 7. Verify email matches
    const userEmail = user.email?.toLowerCase();
    if (userEmail !== tokenPayload.email.toLowerCase()) {
      return NextResponse.json(
        {
          success: false,
          error: `This invitation was sent to ${tokenPayload.email}, but you are logged in as ${userEmail}`,
        },
        { status: 400 }
      );
    }

    // 8. Create service role client for database operations
    let supabase;
    try {
      supabase = getSupabaseServiceRoleClient();
    } catch (error) {
      console.error('[API /invitations/accept] Service role is not configured:', error);
      return NextResponse.json(
        {
          success: false,
          error: 'Server configuration error',
        },
        { status: 500 }
      );
    }

    // 9. Get invitation details
    const { data: invitation, error: invitationError } = await supabase
      .from('collaboration_invitations')
      .select('*, projects:project_id(name)')
      .eq('id', tokenPayload.invitationId)
      .single();

    if (invitationError || !invitation) {
      console.error('[API /invitations/accept] Invitation not found. Error:', invitationError);
      console.error('[API /invitations/accept] Token payload:', JSON.stringify(tokenPayload, null, 2));
      return NextResponse.json(
        { success: false, error: 'Invitation not found' },
        { status: 404 }
      );
    }
    

    // 10. Validate invitation status
    if (invitation.accepted_at) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invitation has already been accepted',
        },
        { status: 400 }
      );
    }

    // 11. Check expiration
    const now = new Date();
    const expiresAt = new Date(invitation.expires_at);
    if (now > expiresAt) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invitation has expired',
        },
        { status: 400 }
      );
    }

    // 12. Check if user already collaborator
    const { data: existingCollab } = await supabase
      .from('project_collaborators')
      .select('id')
      .eq('project_id', invitation.project_id)
      .eq('user_id', user.id)
      .maybeSingle();

    if (existingCollab) {
      // Mark invitation as accepted even though user was already added
      await supabase
        .from('collaboration_invitations')
        .update({
          accepted_at: new Date().toISOString(),
          accepted_by: user.id,
        })
        .eq('id', tokenPayload.invitationId);

      return NextResponse.json({
        success: true,
        projectId: invitation.project_id,
        projectName: invitation.projects?.name || 'Unknown Project',
      });
    }

    // 13. Add user as collaborator
    const { error: collaboratorError } = await supabase
      .from('project_collaborators')
      .insert({
        user_id: user.id,
        project_id: invitation.project_id,
        role: invitation.role,
        invited_by: invitation.invited_by,
        invited_at: invitation.invited_at || invitation.sent_at,
        accepted_at: new Date().toISOString(),
      });

    if (collaboratorError) {
      console.error('Error adding collaborator:', collaboratorError);
      return NextResponse.json(
        {
          success: false,
          error: 'Failed to add collaborator',
        },
        { status: 500 }
      );
    }

    // 14. Mark invitation as accepted
    const { error: updateError } = await supabase
      .from('collaboration_invitations')
      .update({
        accepted_at: new Date().toISOString(),
        accepted_by: user.id,
      })
      .eq('id', tokenPayload.invitationId);

    if (updateError) {
      console.error('Error updating invitation status:', updateError);
      // Don't fail the acceptance - collaborator was already added
    }

    return NextResponse.json({
      success: true,
      projectId: invitation.project_id,
      projectName: invitation.projects?.name || 'Unknown Project',
    });
  } catch (error) {
    console.error('Error in POST /api/invitations/accept:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'An unexpected error occurred',
      },
      { status: 500 }
    );
  }
}, {
  unauthorizedResponse: () => NextResponse.json(
    { success: false, error: 'You must be logged in to accept invitations' },
    { status: 401 }
  ),
});
