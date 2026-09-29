import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/route-auth';
import { DesignToolError, generationStatus } from '@/lib/agent/game-design-system-tool-service';

type Params = { params: Promise<{ id: string }> };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const GET = withAuth(async function GET(_request, { params }: Params, { supabase, user }) {
  const { id } = await params;
  if (!uuidPattern.test(id)) return NextResponse.json({ error: 'Invalid job ID.' }, { status: 400 });
  try {
    const job = await generationStatus({
      userId: user.id, conversationId: '', workspace: 'studio', supabase,
    }, { jobType: 'gdd', jobId: id });
    return NextResponse.json({ job }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return error instanceof DesignToolError
      ? NextResponse.json({ error: 'GDD job not found or access denied.' }, { status: 404 })
      : NextResponse.json({ error: 'GDD status is temporarily unavailable.' }, { status: 503 });
  }
});
