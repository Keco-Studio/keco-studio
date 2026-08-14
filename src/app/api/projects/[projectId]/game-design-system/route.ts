import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/route-auth';
import { AuthorizationError, getUserProjectRole, verifyProjectAccess } from '@/lib/services/authorizationService';
import {
  clearProjectGameDesignSystem,
  getProjectGameDesignSystem,
  setProjectGameDesignSystem,
} from '@/lib/services/gameDesignSystemService';
import { getSupabaseServiceRoleClient } from '@/lib/server/supabaseServiceRole';
import { redactGameDesignSystemDetailForViewer } from '@/lib/game-design-system/sourceVisibility.server';

type Params = { params: Promise<{ projectId: string }> };

async function requireOwnerOrAdmin(supabase: Parameters<typeof getUserProjectRole>[0], projectId: string, userId: string) {
  const access = await getUserProjectRole(supabase, projectId, userId);
  if (!access.isOwner && access.role !== 'admin') {
    throw new AuthorizationError('Only project owners and admins can change the Game Design System.');
  }
}

export const GET = withAuth(async function GET(_request, { params }: Params, { supabase, user }) {
  const { projectId } = await params;
  try {
    await verifyProjectAccess(supabase, projectId);
    const system = await getProjectGameDesignSystem(supabase, projectId, { versionClient: getSupabaseServiceRoleClient() });
    return NextResponse.json({
      system: system ? await redactGameDesignSystemDetailForViewer(supabase, system, user.id) : null,
    });
  } catch (error) {
    console.error('[GET project game design system]', error);
    return NextResponse.json({ error: 'Project or Game Design System not found.' }, { status: 404 });
  }
});

export const PUT = withAuth(async function PUT(request, { params }: Params, { supabase, user }) {
  const { projectId } = await params;
  const body = await request.json().catch(() => null) as { designSystemId?: unknown; versionId?: unknown } | null;
  const designSystemId = typeof body?.designSystemId === 'string' ? body.designSystemId.trim() : '';
  const versionId = typeof body?.versionId === 'string' ? body.versionId.trim() : '';
  if (!designSystemId || !versionId) return NextResponse.json({ error: 'designSystemId and versionId are required.' }, { status: 400 });
  try {
    await requireOwnerOrAdmin(supabase, projectId, user.id);
    const { data: version, error: versionError } = await supabase
      .from('game_design_system_versions')
      .select('id,system_id,conflicts')
      .eq('id', versionId)
      .single();
    if (versionError || !version || version.system_id !== designSystemId) return NextResponse.json({ error: 'Game Design System version not found.' }, { status: 404 });
    if (Array.isArray(version.conflicts) && version.conflicts.length > 0) return NextResponse.json({ error: 'Resolve version conflicts before applying it.' }, { status: 409 });
    await setProjectGameDesignSystem(supabase, projectId, designSystemId, versionId, user.id);
    const system = await getProjectGameDesignSystem(supabase, projectId, { versionClient: getSupabaseServiceRoleClient() });
    return NextResponse.json({
      system: system ? await redactGameDesignSystemDetailForViewer(supabase, system, user.id) : null,
    });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: 'Only project owners and admins can change the Game Design System.' }, { status: 403 });
    }
    console.error('[PUT project game design system]', error);
    return NextResponse.json({ error: 'Failed to apply Game Design System.' }, { status: 400 });
  }
});

export const DELETE = withAuth(async function DELETE(_request, { params }: Params, { supabase, user }) {
  const { projectId } = await params;
  try {
    await requireOwnerOrAdmin(supabase, projectId, user.id);
    await clearProjectGameDesignSystem(supabase, projectId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: 'Only project owners and admins can change the Game Design System.' }, { status: 403 });
    }
    console.error('[DELETE project game design system]', error);
    return NextResponse.json({ error: 'Failed to clear Game Design System.' }, { status: 400 });
  }
});
