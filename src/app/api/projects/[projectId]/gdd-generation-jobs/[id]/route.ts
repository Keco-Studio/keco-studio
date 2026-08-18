import { randomUUID } from 'node:crypto';
import { after, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/route-auth';
import { getUserProjectRole } from '@/lib/services/authorizationService';
import { isGddSchemaUnavailable, safeGddRouteErrorIdentity } from '@/lib/gdd-generation/routeErrors';
import { cancelGddGenerationJob, getPublicGddGenerationJob } from '@/lib/services/gddGenerationService';
import { getSupabaseServiceRoleClient } from '@/lib/server/supabaseServiceRole';
import { processNextGddJob } from '@/lib/gdd-generation/worker';

type Params = { params: Promise<{ projectId: string; id: string }> };
const scheduledQueuedJobs = new Set<string>();

function scheduleQueuedJob(jobId: string): void {
  if (scheduledQueuedJobs.has(jobId)) return;
  scheduledQueuedJobs.add(jobId);
  after(async () => {
    try {
      await processNextGddJob({
        serviceClient: getSupabaseServiceRoleClient(),
        workerId: `gdd-poll-${randomUUID()}`,
      });
    } catch (error) {
      console.error('[GDD polling worker]', safeGddRouteErrorIdentity(error));
    } finally {
      scheduledQueuedJobs.delete(jobId);
    }
  });
}

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
    if (job.status === 'queued') scheduleQueuedJob(job.id);
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

export const DELETE = withAuth(async function DELETE(_request, { params }: Params, { supabase, user }) {
  const { projectId, id } = await params;
  try {
    const access = await getUserProjectRole(supabase, projectId, user.id);
    if (access.role !== 'admin' && access.role !== 'editor') {
      return NextResponse.json({ error: 'Cancelling a GDD generation job requires editor or admin permission.' }, { status: 403 });
    }
    const current = await getPublicGddGenerationJob(supabase, id);
    if (!current || current.project_id !== projectId) {
      return NextResponse.json({ error: 'GDD generation job not found.' }, { status: 404 });
    }
    const job = await cancelGddGenerationJob(getSupabaseServiceRoleClient(), id);
    return NextResponse.json({ job });
  } catch (error) {
    if (isGddSchemaUnavailable(error)) {
      console.error('[DELETE project GDD generation job]', safeGddRouteErrorIdentity(error));
      return NextResponse.json({ error: 'GDD generation database migration is not applied.' }, { status: 503 });
    }
    console.error('[DELETE project GDD generation job]', safeGddRouteErrorIdentity(error));
    return NextResponse.json({ error: 'Failed to cancel GDD generation.' }, { status: 400 });
  }
});
