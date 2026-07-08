/**
 * Delete Project API Route
 * 
 * Handles project deletion by admin users.
 * Uses service role to bypass RLS and allow admin collaborators to delete.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { AuthorizationError } from '@/lib/services/authorizationService';
import { deleteProjectWithServerBoundary } from '@/lib/server/projectDeletion';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

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

    try {
      await deleteProjectWithServerBoundary({
        authClient: userSupabase,
        projectId,
        userId: user.id,
      });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        const status = error.message === 'Project not found' ? 404 : 403;
        return NextResponse.json(
          {
            success: false,
            error: error.message,
          },
          { status }
        );
      }

      console.error('[API /projects/delete] Error deleting project:', error);
      return NextResponse.json(
        {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to delete project',
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
