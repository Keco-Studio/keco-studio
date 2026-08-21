import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuth } from '@/lib/auth/route-auth';
import { gameDesignRuleSetSchema, gameDesignSystemTitleSchema } from '@/lib/game-design-system/ruleSchema';
import { createGameDesignSystem, listGameDesignSystemsPage } from '@/lib/services/gameDesignSystemService';
import { getSupabaseServiceRoleClient } from '@/lib/server/supabaseServiceRole';

const createSchema = z.object({
  title: gameDesignSystemTitleSchema,
  summary: z.string().trim().max(1000).optional(),
  rules: gameDesignRuleSetSchema,
}).strict();

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(101),
  offset: z.coerce.number().int().nonnegative(),
});

export const GET = withAuth(async function GET(request, _context, { supabase }) {
  const searchParams = new URL(request.url).searchParams;
  const parsed = listQuerySchema.safeParse({
    limit: searchParams.get('limit') ?? '51',
    offset: searchParams.get('offset') ?? '0',
  });
  if (!parsed.success) {
    return NextResponse.json({
      error: 'Invalid Game Design System pagination.',
      code: 'FIELD_VALIDATION_FAILED',
    }, { status: 400 });
  }
  try {
    return NextResponse.json(await listGameDesignSystemsPage(supabase, {
      limit: parsed.data.limit ?? 51,
      offset: parsed.data.offset ?? 0,
    }));
  } catch (error) {
    console.error('[GET /api/game-design-systems]', error);
    return NextResponse.json({ error: 'Failed to load Game Design Systems.' }, { status: 500 });
  }
});

export const POST = withAuth(async function POST(request, _context, { supabase, user }) {
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid structured rule set.', issues: parsed.error.flatten() }, { status: 400 });
  try {
    const system = await createGameDesignSystem(getSupabaseServiceRoleClient(), user.id, {
      title: parsed.data.title,
      summary: parsed.data.summary,
      genres: parsed.data.rules.genres,
      philosophies: parsed.data.rules.philosophies,
      suitableFor: parsed.data.rules.suitableFor,
      rules: parsed.data.rules,
      status: 'draft',
    });
    return NextResponse.json({ system }, { status: 201 });
  } catch (error) {
    console.error('[POST /api/game-design-systems]', error);
    return NextResponse.json({ error: 'Failed to create Game Design System.' }, { status: 400 });
  }
});
