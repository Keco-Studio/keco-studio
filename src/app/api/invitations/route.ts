/**
 * Invitation API Route
 * 
 * Handles sending collaboration invitations.
 * Uses authorization header for authentication (compatible with sessionStorage auth).
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendInvitation } from '@/lib/services/collaborationService';
import { generateInvitationToken } from '@/lib/utils/invitationToken';
import type { CollaboratorRole } from '@/lib/types/collaboration';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/**
 * POST /api/invitations
 * Send a collaboration invitation
 */
export async function POST(request: NextRequest) {
  try {
    // 1. Get authorization header
    const authHeader = request.headers.get('authorization');
    console.log('[API /invitations] Auth header:', authHeader ? `exists (${authHeader.substring(0, 20)}...)` : 'missing');
    
    if (!authHeader) {
      return NextResponse.json(
        { success: false, error: 'Missing authorization header' },
        { status: 401 }
      );
    }

    // 2. Extract JWT token from Bearer header
    const jwtToken = authHeader.replace('Bearer ', '');
    
    // 3. Create Supabase client with the JWT token
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
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

    // 4. Verify JWT token and get user
    const { data: { user }, error: authError } = await supabase.auth.getUser(jwtToken);
    console.log('[API /invitations] User:', user ? `${user.id} (${user.email})` : 'null');
    console.log('[API /invitations] Auth error:', authError?.message || 'none');
    
    if (authError || !user) {
      console.error('[API /invitations] Authentication failed');
      return NextResponse.json(
        { success: false, error: 'You must be logged in to send invitations' },
        { status: 401 }
      );
    }

    // 4. Parse request body
    const body = await request.json();
    const { projectId, recipientEmail, role } = body;

    // Validate input
    if (!projectId || !recipientEmail || !role) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields' },
        { status: 400 }
      );
    }

    if (!['admin', 'editor', 'viewer'].includes(role)) {
      return NextResponse.json(
        { success: false, error: 'Invalid role' },
        { status: 400 }
      );
    }

    // 5. Get user profile and project info for email
    const { data: profile } = await supabase
      .from('profiles')
      .select('username, full_name, email')
      .eq('id', user.id)
      .single();

    const { data: project } = await supabase
      .from('projects')
      .select('name')
      .eq('id', projectId)
      .single();

    if (!project) {
      return NextResponse.json(
        { success: false, error: 'Project not found' },
        { status: 404 }
      );
    }

    const inviterName = profile?.username || profile?.full_name || profile?.email || 'A team member';
    const projectName = project.name;

    // 6. Check if recipient already exists
    const { data: recipientProfile } = await supabase
      .from('profiles')
      .select('id, email, username, full_name')
      .eq('email', recipientEmail.toLowerCase())
      .maybeSingle();

    if (recipientProfile) {
      // User exists - check if already a collaborator
      const { data: existingCollaborator } = await supabase
        .from('project_collaborators')
        .select('id')
        .eq('project_id', projectId)
        .eq('user_id', recipientProfile.id)
        .not('accepted_at', 'is', null)
        .maybeSingle();

      if (existingCollaborator) {
        return NextResponse.json({
          success: false,
          error: 'This user is already a collaborator on this project',
        });
      }

      // ✨ User exists but not a collaborator - add them directly!
      console.log('[API /invitations] User exists, adding directly as collaborator');
      
      const { error: addCollaboratorError } = await supabase
        .from('project_collaborators')
        .insert({
          user_id: recipientProfile.id,
          project_id: projectId,
          role: role as CollaboratorRole,
          invited_by: user.id,
          invited_at: new Date().toISOString(),
          accepted_at: new Date().toISOString(), // Auto-accept for existing users
        });

      if (addCollaboratorError) {
        console.error('[API /invitations] Error adding collaborator:', addCollaboratorError);
        return NextResponse.json({
          success: false,
          error: 'Failed to add collaborator: ' + addCollaboratorError.message,
        });
      }

      // Create invitation record for tracking (already accepted)
      const invitationId = crypto.randomUUID();
      await supabase
        .from('collaboration_invitations')
        .insert({
          id: invitationId,
          project_id: projectId,
          recipient_email: recipientEmail.toLowerCase(),
          role,
          invited_by: user.id,
          invitation_token: 'auto-accepted-' + invitationId, // Placeholder token
          accepted_at: new Date().toISOString(),
          accepted_by: recipientProfile.id,
        });

      console.log('[API /invitations] User added successfully as', role);
      
      return NextResponse.json({
        success: true,
        invitationId: invitationId,
        autoAccepted: true,
        message: `${recipientProfile.username || recipientProfile.full_name || recipientEmail} has been added as ${role}`,
      });
    }

    // 7. Check for pending invitation
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
      return NextResponse.json({
        success: false,
        error: 'An invitation has already been sent to this email address',
      });
    }

    // 8. Generate invitation ID and token
    const invitationId = crypto.randomUUID();
    const token = await generateInvitationToken({
      invitationId,
      projectId,
      email: recipientEmail.toLowerCase(),
      role: role as CollaboratorRole,
    });

    // 9. Create invitation record
    const { data: invitation, error: insertError } = await supabase
      .from('collaboration_invitations')
      .insert({
        id: invitationId,
        project_id: projectId,
        recipient_email: recipientEmail.toLowerCase(),
        role,
        invited_by: user.id,
        invitation_token: token,
      })
      .select('id')
      .single();

    if (insertError || !invitation) {
      console.error('Error creating invitation:', insertError);
      return NextResponse.json({
        success: false,
        error: insertError?.message || 'Failed to create invitation',
      });
    }

    // 10. Generate accept link
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const acceptLink = `${appUrl}/accept-invitation?token=${token}`;

    console.log('[API /invitations] Invitation created successfully');
    console.log('[API /invitations] Accept link:', acceptLink);

    // TODO: Send email when email service is configured
    // await sendInvitationEmail({ ... });

    return NextResponse.json({
      success: true,
      invitationId: invitation.id,
    });
  } catch (error) {
    console.error('Error in POST /api/invitations:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'An unexpected error occurred',
      },
      { status: 500 }
    );
  }
}

