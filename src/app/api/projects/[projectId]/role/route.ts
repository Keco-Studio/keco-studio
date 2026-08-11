/**
 * User Project Role API Route
 * 
 * Get the current user's role in a specific project
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth, type AuthedRequest } from '@/lib/auth/route-auth';
import {
  AuthorizationError,
  getUserProjectRole,
} from '@/lib/services/authorizationService';

/**
 * GET /api/projects/[projectId]/role
 * Get current user's role in the project
 */
const getHandler = async (
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
  { supabase, user }: AuthedRequest
) => {
  try {
    const { projectId } = await params;

    // Get role via service
    const result = await getUserProjectRole(supabase, projectId, user.id);
    
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AuthorizationError) {
      const message = error.message.toLowerCase();
      // Project missing can lag briefly after create — clients may retry.
      // Expected in e2e teardown/races; avoid Error-level noise in CI logs.
      if (message.includes('not found')) {
        return NextResponse.json(
          { role: null, isOwner: false },
          { status: 404 }
        );
      }
      console.error('[GET /api/projects/[projectId]/role] Error:', error);
      // Definitive denial (not a collaborator) — do not retry.
      return NextResponse.json(
        { role: null, isOwner: false },
        { status: 403 }
      );
    }

    console.error('[GET /api/projects/[projectId]/role] Error:', error);
    return NextResponse.json(
      { role: null, isOwner: false },
      { status: 500 }
    );
  }
};

export const GET = withAuth(getHandler, {
  unauthorizedResponse: () => NextResponse.json({
    role: null,
    isOwner: false,
  }, { status: 401 }),
});
