import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/route-auth';
import { copyGameDesignSystem, getGameDesignSystem } from '@/lib/services/gameDesignSystemService';
import { getSupabaseServiceRoleClient } from '@/lib/server/supabaseServiceRole';

type Params = { params: Promise<{ id: string }> };

export const POST = withAuth(async function POST(_request, { params }: Params, { supabase, user }) {
  const { id } = await params;
  try {
    const source = await getGameDesignSystem(supabase, id);
    if (!source) return NextResponse.json({ error: 'Game Design System not found.' }, { status: 404 });
    if (source.source !== 'official' && source.owner_id !== user.id) {
      return NextResponse.json({ error: 'Only the owner can copy this Game Design System.' }, { status: 403 });
    }
    const system = await copyGameDesignSystem(getSupabaseServiceRoleClient(), source, user.id);
    return NextResponse.json({ system }, { status: 201 });
  } catch (error) {
    console.error('[POST /api/game-design-systems/:id/copy]', error);
    return NextResponse.json({ error: 'Failed to copy Game Design System.' }, { status: 400 });
  }
});
