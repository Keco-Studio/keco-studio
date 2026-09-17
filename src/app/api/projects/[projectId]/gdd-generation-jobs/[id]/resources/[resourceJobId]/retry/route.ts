import { randomUUID } from 'node:crypto';
import { after, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/route-auth';
import { processNextGddResourceJob } from '@/lib/gdd-generation/resources/worker';
import { getUserProjectRole } from '@/lib/services/authorizationService';
import {
  getGddResourceJob,
  retryFailedGddResourceJob,
  type GddResourceJob,
} from '@/lib/services/gddGenerationService';
import { getSupabaseServiceRoleClient } from '@/lib/server/supabaseServiceRole';

type Params = { params: Promise<{ projectId: string; id: string; resourceJobId: string }> };

function publicResource(resource: GddResourceJob) {
  return {
    id: resource.id,
    kind: resource.kind,
    status: resource.status,
    attempt_count: resource.attempt_count,
    max_attempts: resource.max_attempts,
    available_at: resource.available_at,
    error: resource.error,
    completed_at: resource.completed_at,
  };
}

export const POST = withAuth(async function POST(_request, { params }: Params, { supabase, user }) {
  const { projectId, id, resourceJobId } = await params;
  try {
    const access = await getUserProjectRole(supabase, projectId, user.id);
    if (access.role !== 'admin' && access.role !== 'editor') {
      return NextResponse.json({ error: 'Retrying GDD resources requires editor or admin permission.' }, { status: 403 });
    }

    const serviceClient = getSupabaseServiceRoleClient();
    const current = await getGddResourceJob(serviceClient, { projectId, jobId: id, resourceJobId });
    if (!current) return NextResponse.json({ error: 'GDD resource job not found.' }, { status: 404 });
    if (current.status !== 'failed') {
      return NextResponse.json({ error: 'Only failed GDD resource jobs can be retried.' }, { status: 409 });
    }

    const resource = await retryFailedGddResourceJob(serviceClient, resourceJobId);
    after(async () => {
      try {
        await processNextGddResourceJob({
          serviceClient,
          workerId: `gdd-resource-retry-${randomUUID()}`,
        });
      } catch (error) {
        console.error('[GDD resource retry worker]', error);
      }
    });
    return NextResponse.json({ resource: publicResource(resource) }, { status: 202 });
  } catch (error) {
    console.error('[POST GDD resource retry]', error);
    return NextResponse.json({ error: 'Failed to retry GDD resource generation.' }, { status: 400 });
  }
});
