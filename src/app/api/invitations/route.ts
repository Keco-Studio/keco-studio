/**
 * Invitation API Route
 * 
 * Handles sending collaboration invitations via email.
 * Uses authorization header for authentication (compatible with sessionStorage auth).
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { generateInvitationToken } from '@/lib/utils/invitationToken';
import { sendInvitationEmail, isEmailConfigured } from '@/lib/services/emailService';
import type { CollaboratorRole } from '@/lib/types/collaboration';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/**
 * POST /api/invitations
 * Send a collaboration invitation via email
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
    
    if (authError || !user) {
      console.error('[API /invitations] Authentication failed');
      return NextResponse.json(
        { success: false, error: 'You must be logged in to send invitations' },
        { status: 401 }
      );
    }

    // 5. Parse request body
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

    // 6. Get user profile and project info for email
    const { data: profile } = await supabase
      .from('profiles')
      .select('username, full_name, email')
      .eq('id', user.id)
      .single();

    // Check if user is trying to invite themselves
    if (profile?.email && profile.email.toLowerCase() === recipientEmail.toLowerCase()) {
      return NextResponse.json({
        success: false,
        error: 'Cannot invite yourself',
      });
    }

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

    // 7. Check if recipient already exists
    const { data: recipientProfile } = await supabase
      .from('profiles')
      .select('id, email, username, full_name')
      .eq('email', recipientEmail.toLowerCase())
      .maybeSingle();

    // ❌ User does not exist - cannot invite unregistered users
    if (!recipientProfile) {
      return NextResponse.json({
        success: false,
        error: `The email address "${recipientEmail}" is not registered. Please ask them to sign up first.`,
      });
    }

    // 8. Check if already a collaborator
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
        error: 'User already exists',
      });
    }

    // 🔧 AUTO-ACCEPT MODE: Check if we should skip email and add directly
    // Set SKIP_INVITATION_EMAIL=true in environment variables to auto-accept invitations
    const skipEmail = process.env.SKIP_INVITATION_EMAIL === 'true';
    
    if (skipEmail) {
      console.log('[API /invitations] Auto-accept mode enabled - adding collaborator directly');
      
      // Add user directly as collaborator
      const { error: addError } = await supabase
        .from('project_collaborators')
        .insert({
          user_id: recipientProfile.id,
          project_id: projectId,
          role,
          invited_by: user.id,
          invited_at: new Date().toISOString(),
          accepted_at: new Date().toISOString(),
        });
      
      if (addError) {
        console.error('[API /invitations] Error adding collaborator:', addError);
        return NextResponse.json({
          success: false,
          error: 'Failed to add collaborator: ' + addError.message,
        }, { status: 500 });
      }
      
      const recipientName = recipientProfile.username || recipientProfile.full_name || recipientEmail;
      
      return NextResponse.json({
        success: true,
        autoAccepted: true,
        message: `${recipientName} added as ${role}`,
      });
    }

    // 9. Check for pending invitation
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
        error: 'An invitation has already been sent to this email address' 
      });
    }

    // 10. Generate invitation token
    const invitationId = crypto.randomUUID();
    let token: string;
    try {
      token = await generateInvitationToken({
        invitationId,
        projectId,
        email: recipientEmail.toLowerCase(),
        role,
      });
    } catch (tokenError) {
      console.error('[API /invitations] Error generating token:', tokenError);
      return NextResponse.json({
        success: false,
        error: 'Failed to generate invitation token',
      }, { status: 500 });
    }

    // 11. Create invitation record
    const { error: insertError } = await supabase
      .from('collaboration_invitations')
      .insert({
        id: invitationId,
        project_id: projectId,
        recipient_email: recipientEmail.toLowerCase(),
        role,
        invited_by: user.id,
        invitation_token: token,
      });
    
    if (insertError) {
      console.error('[API /invitations] Error creating invitation:', insertError);
      return NextResponse.json({ 
        success: false, 
        error: insertError.message || 'Failed to create invitation' 
      }, { status: 500 });
    }

    // 12. Send invitation email
    if (!isEmailConfigured()) {
      console.warn('[API /invitations] Email service not configured. Invitation created but email not sent.');
      
      return NextResponse.json({
        success: true,
        invitationId,
        message: 'Invitation created (email service not configured in development)',
      });
    }

    try {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
      const acceptLink = `${appUrl}/accept-invitation?token=${token}`;
      
      await sendInvitationEmail({
        recipientEmail,
        recipientName: recipientProfile.username || recipientProfile.full_name,
        inviterName,
        inviterEmail: profile?.email || '',
        projectName,
        role: role.charAt(0).toUpperCase() + role.slice(1),
        acceptLink,
      });

      
      return NextResponse.json({
        success: true,
        invitationId,
        message: 'Invitation sent successfully!',
      });
    } catch (emailError) {
      console.error('[API /invitations] Error sending email:', emailError);
      
      // Delete the invitation record since email failed
      await supabase
        .from('collaboration_invitations')
        .delete()
        .eq('id', invitationId);
      
      // Check for Resend domain verification error
      const errorMessage = emailError instanceof Error ? emailError.message : String(emailError);
      if (errorMessage.includes('verify a domain') || errorMessage.includes('testing emails')) {
        return NextResponse.json({
          success: false,
          error: 'Email delivery restricted: Please verify a domain in Resend dashboard (resend.com/domains) to send invitations to any email address. Currently, you can only send to your registered email.',
        }, { status: 403 });
      }
      
      return NextResponse.json({
        success: false,
        error: 'Failed to send invitation email. Please try again.',
      }, { status: 500 });
    }
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

