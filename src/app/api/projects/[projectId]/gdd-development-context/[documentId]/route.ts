import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/route-auth';
import { developmentTargetProfileSchema } from '@/lib/gdd-development/contracts';
import {
  GddDevelopmentContextNotFoundError,
  readGddDevelopmentContext,
} from '@/lib/gdd-development/contextService';
import { getSupabaseServiceRoleClient } from '@/lib/server/supabaseServiceRole';
import { AuthorizationError, getUserProjectRole } from '@/lib/services/authorizationService';

type Params = { params: Promise<{ projectId: string; documentId: string }> };
const HEADERS = { 'Cache-Control': 'private, no-store' };

export const GET = withAuth(async function GET(request: Request, { params }: Params, { supabase, user }) {
  const { projectId, documentId } = await params;
  const rawProfile = new URL(request.url).searchParams.get('targetProfile');
  let targetProfile;
  if (rawProfile !== null) {
    try {
      const parsed = developmentTargetProfileSchema.safeParse(JSON.parse(rawProfile));
      if (!parsed.success) throw new Error('invalid profile');
      targetProfile = parsed.data;
    } catch {
      return NextResponse.json({ error: 'Invalid development target profile.', code: 'FIELD_VALIDATION_FAILED' }, { status: 400, headers: HEADERS });
    }
  }
  try {
    await getUserProjectRole(supabase, projectId, user.id);
    const context = await readGddDevelopmentContext(getSupabaseServiceRoleClient(), {
      projectId,
      documentId,
      ...(targetProfile ? { targetProfile } : {}),
    });
    return NextResponse.json({ context }, { headers: HEADERS });
  } catch (error) {
    if (error instanceof GddDevelopmentContextNotFoundError || error instanceof AuthorizationError) {
      return NextResponse.json({ error: 'GDD Document not found.', code: 'PROJECT_NOT_ACCESSIBLE' }, { status: 404, headers: HEADERS });
    }
    const code = error && typeof error === 'object' && 'code' in error ? String((error as { code: unknown }).code) : '';
    if (code === 'P0002' || code === 'PGRST116' || code === '42501') {
      return NextResponse.json({ error: 'GDD Document not found.', code: 'PROJECT_NOT_ACCESSIBLE' }, { status: 404, headers: HEADERS });
    }
    console.error('[GET GDD development context]', { code: code || 'unknown' });
    return NextResponse.json({ error: 'GDD development context is temporarily unavailable.', code: 'UPSTREAM_UNAVAILABLE' }, { status: 503, headers: HEADERS });
  }
}, {
  unauthorizedResponse: () => NextResponse.json({ error: 'Please sign in to continue' }, { status: 401, headers: HEADERS }),
});
