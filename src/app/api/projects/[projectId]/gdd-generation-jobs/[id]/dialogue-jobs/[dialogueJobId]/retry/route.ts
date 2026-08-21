import { randomUUID } from 'node:crypto';
import { after, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/route-auth';
import { processNextDialogueJob } from '@/lib/gdd-generation/dialogueWorker';
import { getUserProjectRole } from '@/lib/services/authorizationService';
import {
  getDialogueGenerationJob,
  retryDialogueGenerationJob,
} from '@/lib/services/dialogueGenerationService';
import { getSupabaseServiceRoleClient } from '@/lib/server/supabaseServiceRole';

type Params = { params: Promise<{ projectId: string; id: string; dialogueJobId: string }> };

export const POST = withAuth(async function POST(_request, { params }: Params, { supabase, user }) {
  const { projectId, id, dialogueJobId } = await params;
  try {
    const access = await getUserProjectRole(supabase, projectId, user.id);
    if (access.role !== 'admin' && access.role !== 'editor') {
      return NextResponse.json({ error: 'Retrying dialogue jobs requires editor or admin permission.' }, { status: 403 });
    }
    const serviceClient = getSupabaseServiceRoleClient();
    const current = await getDialogueGenerationJob(serviceClient, projectId, id, dialogueJobId);
    if (!current) return NextResponse.json({ error: 'Dialogue generation job not found.' }, { status: 404 });
    if (current.status !== 'failed') {
      return NextResponse.json({ error: 'Only failed dialogue jobs can be retried.' }, { status: 409 });
    }
    const job = await retryDialogueGenerationJob(serviceClient, dialogueJobId, user.id);
    after(async () => {
      try {
        await processNextDialogueJob({ serviceClient, workerId: `dialogue-retry-${randomUUID()}` });
      } catch (error) {
        console.error('[GDD dialogue retry worker]', error);
      }
    });
    return NextResponse.json({ job }, { status: 202 });
  } catch (error) {
    console.error('[POST GDD dialogue retry]', error);
    return NextResponse.json({ error: 'Failed to retry dialogue generation.' }, { status: 400 });
  }
});
