/**
 * Delete Project API Route
 * 
 * Handles project deletion by admin users.
 * Uses service role to bypass RLS and allow admin collaborators to delete.
 */

import { after, NextRequest, NextResponse } from 'next/server';
import { withAuth, type AuthedRequest } from '@/lib/auth/route-auth';
import { AuthorizationError } from '@/lib/services/authorizationService';
import {
  deleteProjectWithServerBoundary,
  processProjectStorageCleanupJob,
} from '@/lib/server/projectDeletion';

/**
 * DELETE /api/projects/[projectId]/delete
 * Delete a project (admin only)
 */
const deleteHandler = async (
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
  { supabase: userSupabase, user }: AuthedRequest
) => {
  try {
    // In Next.js 15, params is a Promise and must be awaited
    const { projectId } = await params;

    try {
      const deletion = await deleteProjectWithServerBoundary({
        authClient: userSupabase,
        projectId,
        userId: user.id,
      });
      if (deletion.cleanupJobId) {
        after(async () => {
          try {
            await processProjectStorageCleanupJob({ cleanupJobId: deletion.cleanupJobId! });
          } catch (cleanupError) {
            console.error('[API /projects/delete] Deferred storage cleanup failed:', cleanupError);
          }
        });
      }
    } catch (error) {
      if (error instanceof AuthorizationError) {
        const status = error.message === 'Project not found' ? 404 : 403;
        return NextResponse.json(
          {
            success: false,
            error: status === 404 ? 'Project not found' : 'Forbidden',
          },
          { status }
        );
      }

      console.error('[API /projects/delete] Error deleting project:', error);
      return NextResponse.json(
        {
          success: false,
          error: 'Failed to delete project',
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
        error: 'An unexpected error occurred',
      },
      { status: 500 }
    );
  }
};

export const DELETE = withAuth(deleteHandler, {
  unauthorizedResponse: () => NextResponse.json(
    { success: false, error: 'You must be logged in to delete projects' },
    { status: 401 }
  ),
});
