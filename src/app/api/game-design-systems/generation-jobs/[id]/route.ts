import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/route-auth';
import { getGameDesignSystemGenerationJob } from '@/lib/services/gameDesignSystemService';

type Params = { params: Promise<{ id: string }> };

export const GET = withAuth(async function GET(_request, { params }: Params, { supabase }) {
  const { id } = await params;
  try {
    const job = await getGameDesignSystemGenerationJob(supabase, id);
    if (!job) return NextResponse.json({ error: 'Generation job not found.' }, { status: 404 });
    return NextResponse.json({ job });
  } catch (error) {
    console.error('[GET /api/game-design-systems/generation-jobs/:id]', error);
    return NextResponse.json({ error: 'Failed to load generation job.' }, { status: 500 });
  }
});
