/**
 * Delete Project API Route
 * 
 * Handles project deletion by admin users.
 * Uses service role to bypass RLS and allow admin collaborators to delete.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseServiceRoleKey) {
  console.error('[API /projects/[projectId]/delete] SUPABASE_SERVICE_ROLE_KEY is not configured');
}

/**
 * DELETE /api/projects/[projectId]/delete
 * Delete a project (admin only)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    // In Next.js 15, params is a Promise and must be awaited
    const { projectId } = await params;

    // 1. Get authorization header
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json(
        { success: false, error: 'Missing authorization header' },
        { status: 401 }
      );
    }

    // 2. Extract JWT token
    const jwtToken = authHeader.replace('Bearer ', '');

    // 3. Create Supabase client with user auth to verify user
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

    // 4. Verify user is authenticated
    const { data: { user }, error: authError } = await userSupabase.auth.getUser(jwtToken);
    
    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: 'You must be logged in to delete projects' },
        { status: 401 }
      );
    }

    // 5. Use service role client for permission checking and deletion
    if (!supabaseServiceRoleKey) {
      return NextResponse.json(
        {
          success: false,
          error: 'Server configuration error: SUPABASE_SERVICE_ROLE_KEY is not set',
        },
        { status: 500 }
      );
    }

    const serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    // 6. Check if user has admin permission (using service role to bypass RLS)
    // First check if user is owner
    const { data: project, error: projectError } = await serviceClient
      .from('projects')
      .select('owner_id')
      .eq('id', projectId)
      .single();

    if (projectError || !project) {
      console.error('[API /projects/delete] Project not found:', projectError?.message);
      return NextResponse.json(
        {
          success: false,
          error: 'Project not found',
        },
        { status: 404 }
      );
    }

    const isOwner = project.owner_id === user.id;

    // Check collaborator role
    const { data: collaborator, error: collabError } = await serviceClient
      .from('project_collaborators')
      .select('role, accepted_at')
      .eq('project_id', projectId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (collabError) {
      console.error('[API /projects/delete] Error checking collaborator:', collabError);
      return NextResponse.json(
        {
          success: false,
          error: 'Error checking permissions',
        },
        { status: 500 }
      );
    }

    // Determine user role: collaborator role takes precedence over owner
    let userRole: string | null = null;
    if (collaborator && collaborator.accepted_at) {
      userRole = collaborator.role;
    } else if (isOwner) {
      userRole = 'admin'; // Owner defaults to admin if not a collaborator
    }

    // Only admin can delete
    if (userRole !== 'admin') {
      return NextResponse.json(
        {
          success: false,
          error: 'Only admin users can delete projects',
        },
        { status: 403 }
      );
    }

    // 7. Delete the project
    const { error: deleteError } = await serviceClient
      .from('projects')
      .delete()
      .eq('id', projectId);

    if (deleteError) {
      console.error('[API /projects/delete] Error deleting project:', deleteError);
      return NextResponse.json(
        {
          success: false,
          error: 'Failed to delete project: ' + deleteError.message,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Project deleted successfully',
    });
  } catch (error) {
    console.error('[API /projects/delete] Unexpected error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'An unexpected error occurred',
      },
      { status: 500 }
    );
  }
}

