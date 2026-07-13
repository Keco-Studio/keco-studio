/**
 * User Project Role API Route
 * 
 * Get the current user's role in a specific project
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth, type AuthedRequest } from '@/lib/auth/route-auth';
import { getUserProjectRole } from '@/lib/services/authorizationService';

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
    console.error('[GET /api/projects/[projectId]/role] Error:', error);
    return NextResponse.json({
      role: null,
      isOwner: false,
    });
  }
};

export const GET = withAuth(getHandler, {
  unauthorizedResponse: () => NextResponse.json({
    role: null,
    isOwner: false,
  }),
});
