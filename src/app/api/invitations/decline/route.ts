/**
 * Decline Invitation API Route
 * 
 * Handles declining collaboration invitations.
 * Validates JWT token and marks invitation as declined.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { validateInvitationToken } from '@/lib/utils/invitationToken';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseServiceRoleKey) {
  console.error('[API /invitations/decline] SUPABASE_SERVICE_ROLE_KEY is not configured');
}

/**
 * POST /api/invitations/decline
 * Decline a collaboration invitation (no authentication required)
 */
export async function POST(request: NextRequest) {
  try {
    // 1. Get invitation token from request body
    const body = await request.json();
    const { invitationToken } = body;

    if (!invitationToken) {
      return NextResponse.json(
        { success: false, error: 'Missing invitation token' },
        { status: 400 }
      );
    }

    // 2. Validate invitation token
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

    // 3. Create service role client for database operations
    if (!supabaseServiceRoleKey) {
      return NextResponse.json(
        {
          success: false,
          error: 'Server configuration error',
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

    // 4. Get invitation details
    const { data: invitation, error: invitationError } = await supabase
      .from('collaboration_invitations')
      .select('*')
      .eq('id', tokenPayload.invitationId)
      .single();

    if (invitationError || !invitation) {
      return NextResponse.json(
        { success: false, error: 'Invitation not found' },
        { status: 404 }
      );
    }

    // 5. Check if invitation was already accepted or declined
    if (invitation.accepted_at) {
      return NextResponse.json(
        {
          success: false,
          error: 'This invitation has already been accepted',
        },
        { status: 400 }
      );
    }

    // 6. Check expiration
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

    // 7. Mark invitation as declined by deleting it
    // (We delete instead of marking to avoid cluttering the database)
    const { error: deleteError } = await supabase
      .from('collaboration_invitations')
      .delete()
      .eq('id', tokenPayload.invitationId);

    if (deleteError) {
      console.error('Error declining invitation:', deleteError);
      return NextResponse.json(
        {
          success: false,
          error: 'Failed to decline invitation',
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Invitation declined successfully',
    });
  } catch (error) {
    console.error('Error in POST /api/invitations/decline:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'An unexpected error occurred',
      },
      { status: 500 }
    );
  }
}

