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
  try {
    const system = await getGameDesignSystemDetail(supabase, id, { versionClient: getSupabaseServiceRoleClient() });
    return system
      ? NextResponse.json({ system: await redactGameDesignSystemDetailForViewer(supabase, system, user.id) })
      : NextResponse.json({ error: 'Game Design System not found.' }, { status: 404 });
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

export const DELETE = withAuth(async function DELETE(_request, { params }: Params, { supabase }) {
  const { id } = await params;
  const { error } = await supabase.from('game_design_systems').delete().eq('id', id);
  if (error) return NextResponse.json({ error: 'Failed to delete Game Design System.' }, { status: 400 });
  return NextResponse.json({ ok: true });
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
