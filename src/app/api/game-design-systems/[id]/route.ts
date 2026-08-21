import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuth } from '@/lib/auth/route-auth';
import { copyGameDesignSystem, getGameDesignSystem, getGameDesignSystemDetail, updateGameDesignSystem } from '@/lib/services/gameDesignSystemService';
import { getSupabaseServiceRoleClient } from '@/lib/server/supabaseServiceRole';
import { redactGameDesignSystemDetailForViewer } from '@/lib/game-design-system/sourceVisibility.server';
import { gameDesignSystemTitleSchema } from '@/lib/game-design-system/ruleSchema';

type Params = { params: Promise<{ id: string }> };

const metadataSchema = z.object({
  title: gameDesignSystemTitleSchema.optional(),
  summary: z.string().trim().max(1000).nullable().optional(),
  status: z.enum(['draft', 'published']).optional(),
}).strict();

export const GET = withAuth(async function GET(_request, { params }: Params, { supabase, user }) {
  const { id } = await params;
  const rawLimit = new URL(_request.url).searchParams.get('versionLimit');
  const parsedLimit = rawLimit === null
    ? { success: true as const, data: undefined }
    : z.coerce.number().int().min(1).max(50).safeParse(rawLimit);
  if (!parsedLimit.success) {
    return NextResponse.json({
      error: 'Invalid Game Design System version limit.',
      code: 'FIELD_VALIDATION_FAILED',
    }, { status: 400 });
  }
  try {
    const system = await getGameDesignSystemDetail(supabase, id, {
      snapshotClient: getSupabaseServiceRoleClient(),
      versionLimit: parsedLimit.data,
    });
    return system
      ? NextResponse.json({ system: await redactGameDesignSystemDetailForViewer(supabase, system, user.id) })
      : NextResponse.json({
          error: 'Game Design System not found.',
          code: 'GDS_NOT_FOUND',
        }, { status: 404 });
  } catch (error) {
    console.error('[GET /api/game-design-systems/:id]', error);
    return NextResponse.json({ error: 'Failed to load Game Design System.' }, { status: 500 });
  }
});

export const PATCH = withAuth(async function PATCH(request, { params }: Params, { supabase }) {
  const { id } = await params;
  const parsed = metadataSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Only title, summary, and status metadata can be edited.', issues: parsed.error.flatten() }, { status: 400 });
  try {
    return NextResponse.json({ system: await updateGameDesignSystem(supabase, id, parsed.data) });
  } catch (error) {
    console.error('[PATCH /api/game-design-systems/:id]', error);
    return NextResponse.json({ error: 'Failed to update Game Design System metadata.' }, { status: 403 });
  }
});

type DeleteDatabaseError = { code?: string };

function deleteErrorResponse(error: DeleteDatabaseError) {
  if (error.code === '42501') {
    return NextResponse.json({ error: 'You are not allowed to delete this Game Design System.' }, { status: 403 });
  }
  if (error.code === '23503') {
    return NextResponse.json({ error: 'Unbind this Game Design System from all projects before deleting it.' }, { status: 409 });
  }
  return NextResponse.json({ error: 'Failed to delete Game Design System.' }, { status: 400 });
}

async function lookupDeleteTarget(admin: ReturnType<typeof getSupabaseServiceRoleClient>, id: string) {
  const { data, error } = await admin
    .from('game_design_systems')
    .select('id,source,owner_id')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data as { id: string; source: string; owner_id: string | null } | null;
}

async function hasProjectBinding(admin: ReturnType<typeof getSupabaseServiceRoleClient>, id: string) {
  const { data, error } = await admin
    .from('project_game_design_systems')
    .select('project_id')
    .eq('design_system_id', id)
    .limit(1);
  if (error) throw error;
  return Array.isArray(data) && data.length > 0;
}

export const DELETE = withAuth(async function DELETE(_request, { params }: Params, { supabase, user }) {
  const { id } = await params;
  const admin = getSupabaseServiceRoleClient();

  try {
    const target = await lookupDeleteTarget(admin, id);
    if (!target) return NextResponse.json({ error: 'Game Design System not found.' }, { status: 404 });
    if (target.source !== 'user' || target.owner_id !== user.id) {
      return NextResponse.json({ error: 'Only the owner can delete this Game Design System.' }, { status: 403 });
    }
    if (await hasProjectBinding(admin, id)) {
      return NextResponse.json({ error: 'Unbind this Game Design System from all projects before deleting it.' }, { status: 409 });
    }

    const { data: deleted, error } = await supabase
      .from('game_design_systems')
      .delete()
      .eq('id', id)
      .select('id')
      .maybeSingle();
    if (error) return deleteErrorResponse(error);
    if (deleted && typeof deleted === 'object' && 'id' in deleted) return NextResponse.json({ ok: true });

    // RLS can turn an unauthorized delete into a successful zero-row response.
    // Re-check the authoritative row so a concurrent delete is reported as 404,
    // while a row that still exists is never reported as successful.
    const remaining = await lookupDeleteTarget(admin, id);
    if (!remaining) return NextResponse.json({ error: 'Game Design System not found.' }, { status: 404 });
    if (await hasProjectBinding(admin, id)) {
      return NextResponse.json({ error: 'Unbind this Game Design System from all projects before deleting it.' }, { status: 409 });
    }
    return NextResponse.json({ error: 'You are not allowed to delete this Game Design System.' }, { status: 403 });
  } catch (error) {
    console.error('[DELETE /api/game-design-systems/:id]', error);
    return NextResponse.json({ error: 'Failed to delete Game Design System.' }, { status: 500 });
  }
});

/** Backward-compatible copy action; new clients use /:id/copy. */
export const POST = withAuth(async function POST(_request, { params }: Params, { supabase, user }) {
  const { id } = await params;
  try {
    const source = await getGameDesignSystem(supabase, id);
    if (!source) return NextResponse.json({ error: 'Game Design System not found.' }, { status: 404 });
    if (source.source !== 'official' && source.owner_id !== user.id) {
      return NextResponse.json({ error: 'Only the owner can copy this Game Design System.' }, { status: 403 });
    }
    return NextResponse.json({ system: await copyGameDesignSystem(getSupabaseServiceRoleClient(), source, user.id) }, { status: 201 });
  } catch (error) {
    console.error('[POST /api/game-design-systems/:id]', error);
    return NextResponse.json({ error: 'Failed to copy Game Design System.' }, { status: 400 });
  }
});
