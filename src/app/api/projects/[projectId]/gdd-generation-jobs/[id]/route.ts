import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/route-auth';
import { getUserProjectRole } from '@/lib/services/authorizationService';
import { isGddSchemaUnavailable, safeGddRouteErrorIdentity } from '@/lib/gdd-generation/routeErrors';
import { getPublicGddGenerationJob } from '@/lib/services/gddGenerationService';

type Params = { params: Promise<{ projectId: string; id: string }> };

export const GET = withAuth(async function GET(_request, { params }: Params, { supabase, user }) {
  const { projectId, id } = await params;
  try {
    const access = await getUserProjectRole(supabase, projectId, user.id);
    if (access.role !== 'admin' && access.role !== 'editor') {
      return NextResponse.json({ error: 'Reading a GDD generation job requires editor or admin permission.' }, { status: 403 });
    }
  } catch {
    return NextResponse.json({ error: 'Reading a GDD generation job requires editor or admin permission.' }, { status: 403 });
  }
  try {
    const job = await getPublicGddGenerationJob(supabase, id);
    if (!job || job.project_id !== projectId) return NextResponse.json({ error: 'GDD generation job not found.' }, { status: 404 });
    return NextResponse.json({ job });
  } catch (error) {
    if (isGddSchemaUnavailable(error)) {
      console.error('[GET project GDD generation job]', safeGddRouteErrorIdentity(error));
      return NextResponse.json({ error: 'GDD generation database migration is not applied.' }, { status: 503 });
    }
    console.error('[GET project GDD generation job]', safeGddRouteErrorIdentity(error));
    return NextResponse.json({ error: 'GDD generation job not found.' }, { status: 404 });
  }
});
