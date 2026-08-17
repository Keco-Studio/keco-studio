import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/route-auth';
import { verifyProjectAccess } from '@/lib/services/authorizationService';
import { getGddGenerationJob } from '@/lib/services/gddGenerationService';

type Params = { params: Promise<{ projectId: string; id: string }> };

export const GET = withAuth(async function GET(_request, { params }: Params, { supabase }) {
  const { projectId, id } = await params;
  try {
    await verifyProjectAccess(supabase, projectId);
    const job = await getGddGenerationJob(supabase, id);
    if (!job || job.project_id !== projectId) return NextResponse.json({ error: 'GDD generation job not found.' }, { status: 404 });
    return NextResponse.json({ job });
  } catch (error) {
    console.error('[GET project GDD generation job]', error);
    return NextResponse.json({ error: 'GDD generation job not found.' }, { status: 404 });
  }
});
