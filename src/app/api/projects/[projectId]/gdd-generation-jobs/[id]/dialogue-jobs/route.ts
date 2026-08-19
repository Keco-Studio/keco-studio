import { randomUUID } from 'node:crypto';
import { after, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/route-auth';
import { processNextDialogueJob } from '@/lib/gdd-generation/dialogueWorker';
import { getUserProjectRole } from '@/lib/services/authorizationService';
import {
  findWakeableDialogueGenerationJob,
  listDialogueGenerationJobs,
} from '@/lib/services/dialogueGenerationService';
import { getGddGenerationJob } from '@/lib/services/gddGenerationService';
import { getSupabaseServiceRoleClient } from '@/lib/server/supabaseServiceRole';

type Params = { params: Promise<{ projectId: string; id: string }> };
const scheduledJobs = new Set<string>();

function scheduleDialogueJob(jobId: string): void {
  if (scheduledJobs.has(jobId)) return;
  scheduledJobs.add(jobId);
  after(async () => {
    try {
      await processNextDialogueJob({
        serviceClient: getSupabaseServiceRoleClient(),
        workerId: `dialogue-poll-${randomUUID()}`,
      });
    } catch (error) {
      console.error('[GDD dialogue polling worker]', error);
    } finally {
      scheduledJobs.delete(jobId);
    }
  });
}

export const GET = withAuth(async function GET(_request, { params }: Params, { supabase, user }) {
  const { projectId, id } = await params;
  try {
    const access = await getUserProjectRole(supabase, projectId, user.id);
    if (access.role !== 'admin' && access.role !== 'editor') {
      return NextResponse.json({ error: 'Reading dialogue jobs requires editor or admin permission.' }, { status: 403 });
    }
    const serviceClient = getSupabaseServiceRoleClient();
    const parent = await getGddGenerationJob(serviceClient, id);
    if (!parent || parent.project_id !== projectId) {
      return NextResponse.json({ error: 'GDD generation job not found.' }, { status: 404 });
    }
    const [jobs, dueJob] = await Promise.all([
      listDialogueGenerationJobs(serviceClient, projectId, id),
      findWakeableDialogueGenerationJob(serviceClient, projectId, id),
    ]);
    if (dueJob) scheduleDialogueJob(dueJob.id);
    return NextResponse.json({ jobs });
  } catch (error) {
    console.error('[GET GDD dialogue jobs]', error);
    return NextResponse.json({ error: 'Failed to load dialogue jobs.' }, { status: 404 });
  }
});
