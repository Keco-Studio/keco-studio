import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/route-auth';
import { listGameDesignReferenceOptions } from '@/lib/game-design-system/sourceSnapshots';

export const GET = withAuth(async function GET(request, _context, { supabase }) {
  const projectId = new URL(request.url).searchParams.get('projectId')?.trim();
  if (!projectId) return NextResponse.json({ error: 'projectId is required.' }, { status: 400 });
  try {
    const options = await listGameDesignReferenceOptions(supabase, projectId);
    return NextResponse.json({ options });
  } catch (error) {
    console.error('[GET /api/game-design-systems/reference-options]', error);
    return NextResponse.json({ error: 'Project sources could not be loaded.' }, { status: 403 });
  }
});
