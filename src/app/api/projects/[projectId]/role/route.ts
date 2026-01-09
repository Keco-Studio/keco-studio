/**
 * User Project Role API Route
 * 
 * Get the current user's role in a specific project
 */

import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/createSupabaseServerClient';
import { getUserProjectRole } from '@/lib/services/collaborationService';

/**
 * GET /api/projects/[projectId]/role
 * Get current user's role in the project
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;

    // Create Supabase client from request (extracts auth from headers)
    const supabase = createSupabaseServerClient(request);

    // Get current user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json({
        role: null,
        isOwner: false,
      });
    }

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
}

