import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/route-auth';

export const GET = withAuth(async function GET(_request, _context, { supabase, user }) {
  const [projects, collaborations] = await Promise.all([
    supabase.from('projects')
      .select('id,name,owner_id')
      .order('created_at', { ascending: true }),
    supabase.from('project_collaborators')
      .select('project_id,role,accepted_at')
      .eq('user_id', user.id)
      .not('accepted_at', 'is', null)
      .in('role', ['admin', 'editor']),
  ]);
  if (projects.error || collaborations.error) {
    console.error('[GET /api/projects/writable] Failed to load writable projects');
    return NextResponse.json({ error: 'Failed to load writable projects' }, { status: 500 });
  }

  const collaboratorProjectIds = new Set(
    (collaborations.data ?? []).map((row) => row.project_id as string),
  );
  return NextResponse.json(
    (projects.data ?? [])
      .filter((project) => project.owner_id === user.id || collaboratorProjectIds.has(project.id as string))
      .map((project) => ({ id: project.id, name: project.name })),
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}, {
  unauthorizedResponse: () => NextResponse.json({ error: 'unauthorized' }, { status: 401 }),
});
