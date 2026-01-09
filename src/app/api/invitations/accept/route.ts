/**
 * Accept Invitation API Route
 * 
 * Handles accepting collaboration invitations.
 * Validates JWT token and adds user as collaborator.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { validateInvitationToken } from '@/lib/utils/invitationToken';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseServiceRoleKey) {
  console.error('[API /invitations/accept] SUPABASE_SERVICE_ROLE_KEY is not configured');
}

/**
 * POST /api/invitations/accept
 * Accept a collaboration invitation
 */
export async function POST(request: NextRequest) {
  try {
    // 1. Get authorization header
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json(
        { success: false, error: 'Missing authorization header' },
        { status: 401 }
      );
    }

    // 2. Get JWT token and invitation token from request body
    const body = await request.json();
    const { invitationToken } = body;

    if (!invitationToken) {
      return NextResponse.json(
        { success: false, error: 'Missing invitation token' },
        { status: 400 }
      );
    }

    // 3. Extract user JWT from Bearer header
    const jwtToken = authHeader.replace('Bearer ', '');

    // 4. Create Supabase client with user auth to verify user
    const userSupabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    // 5. Verify user is authenticated
    const { data: { user }, error: authError } = await userSupabase.auth.getUser(jwtToken);
    
    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: 'You must be logged in to accept invitations' },
        { status: 401 }
      );
    }

    // 6. Validate invitation token
    let tokenPayload;
    try {
      tokenPayload = await validateInvitationToken(invitationToken);
    } catch (error) {
      console.error('Token validation error:', error);
      return NextResponse.json(
        {
          success: false,
          error: error instanceof Error ? error.message : 'Invalid invitation token',
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
    if (!supabaseServiceRoleKey) {
      return NextResponse.json(
        {
          success: false,
          error: 'Server configuration error: SUPABASE_SERVICE_ROLE_KEY is not set. Please check your .env.local file.',
        },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    // 9. Get invitation details
    const { data: invitation, error: invitationError } = await supabase
      .from('collaboration_invitations')
      .select('*, projects:project_id(name)')
      .eq('id', tokenPayload.invitationId)
      .single();

    if (invitationError || !invitation) {
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
          error: 'Failed to add collaborator: ' + collaboratorError.message,
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

    console.log('[API /invitations/accept] Invitation accepted successfully');
    console.log('[API /invitations/accept] Added user', user.id, 'as', invitation.role, 'to project', invitation.project_id);

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
        error: error instanceof Error ? error.message : 'An unexpected error occurred',
      },
      { status: 500 }
    );
  }
}

