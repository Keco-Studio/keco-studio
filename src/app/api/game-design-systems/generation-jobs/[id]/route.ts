import { after, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { withAuth } from '@/lib/auth/route-auth';
import { shouldWakeGameDesignSystemGenerationJob, processNextGameDesignSystemJob } from '@/lib/game-design-system/worker';
import { getGameDesignSystemGenerationJob, publicGameDesignSystemGenerationJob } from '@/lib/services/gameDesignSystemService';
import { getSupabaseServiceRoleClient } from '@/lib/server/supabaseServiceRole';

type Params = { params: Promise<{ id: string }> };
const scheduledJobs = new Set<string>();

function scheduleQueuedJob(jobId: string): void {
  if (scheduledJobs.has(jobId)) return;
  scheduledJobs.add(jobId);
  after(async () => {
    try {
      await processNextGameDesignSystemJob({
        serviceClient: getSupabaseServiceRoleClient(),
        workerId: `system-poll-${randomUUID()}`,
      });
    } catch (error) {
      console.error('[Game Design System polling worker]', error);
    } finally {
      scheduledJobs.delete(jobId);
    }
  });
}

export const GET = withAuth(async function GET(_request, { params }: Params, { supabase }) {
  const { id } = await params;
  try {
    const job = await getGameDesignSystemGenerationJob(supabase, id);
    if (!job) {
      return NextResponse.json({
        error: 'Generation job not found.',
        code: 'GDS_NOT_FOUND',
      }, { status: 404 });
    }
    if (shouldWakeGameDesignSystemGenerationJob(job)) scheduleQueuedJob(job.id);
    return NextResponse.json({ job: publicGameDesignSystemGenerationJob(job) });
  } catch (error) {
    console.error('[GET /api/game-design-systems/generation-jobs/:id]', error);
    return NextResponse.json({ error: 'Failed to load generation job.' }, { status: 500 });
  }
});
