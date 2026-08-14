import { after, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { withAuth } from '@/lib/auth/route-auth';
import { gameDesignSystemTitleSchema } from '@/lib/game-design-system/ruleSchema';
import { resolveGameDesignSourceSnapshots, SourceSnapshotInputError } from '@/lib/game-design-system/sourceSnapshots';
import { hashResolvedGenerationInput, type ResolvedGameDesignGenerationInput } from '@/lib/gameDesignSystemGeneration';
import { getGameDesignSystemDetail, createGameDesignSystemGenerationJob, IdempotencyConflictError } from '@/lib/services/gameDesignSystemService';
import { getSupabaseServiceRoleClient } from '@/lib/server/supabaseServiceRole';
import { processNextGameDesignSystemJob } from '@/lib/game-design-system/worker';

export const maxDuration = 120;

const requestSchema = z.object({
  title: gameDesignSystemTitleSchema,
  genres: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  philosophies: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
  description: z.string().trim().max(4000).optional(),
  suitableFor: z.string().trim().max(500).optional(),
  baseSystemId: z.string().uuid().optional(),
  pastedMarkdown: z.string().max(20_000).optional(),
  references: z.array(z.object({
    kind: z.enum(['document', 'table']),
    projectId: z.string().uuid(),
    resourceId: z.string().uuid(),
  }).strict()).max(10).default([]),
  referenceGames: z.array(z.object({
    name: z.string().trim().min(1).max(120),
    reference: z.string().trim().max(500),
    avoid: z.string().trim().max(500),
  }).strict()).max(10).default([]),
}).strict();

function idempotencyKey(request: Request): string | null {
  const value = request.headers.get('idempotency-key')?.trim();
  return value && /^[A-Za-z0-9._:-]{8,128}$/.test(value) ? value : null;
}

function scheduleWorker(): void {
  after(async () => {
    try {
      await processNextGameDesignSystemJob({
        serviceClient: getSupabaseServiceRoleClient(),
        workerId: `request-${randomUUID()}`,
      });
    } catch (error) {
      console.error('[Game Design System opportunistic worker]', error);
    }
  });
}

export const POST = withAuth(async function POST(request, _context, { supabase, user }) {
  const key = idempotencyKey(request);
  if (!key) return NextResponse.json({ error: 'A valid Idempotency-Key header is required.' }, { status: 400 });
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid generation request.', issues: parsed.error.flatten() }, { status: 400 });
  const body = parsed.data;
  if (body.genres.length === 0 && body.philosophies.length === 0 && !body.description && !body.pastedMarkdown && body.references.length === 0 && body.referenceGames.length === 0 && !body.baseSystemId) {
    return NextResponse.json({ error: 'Add a genre, philosophy, description, source, or base system.' }, { status: 400 });
  }
  try {
    const sourceSnapshots = await resolveGameDesignSourceSnapshots(supabase, body.references.map((reference) => ({
      kind: reference.kind!,
      projectId: reference.projectId!,
      resourceId: reference.resourceId!,
    })));
    const base = body.baseSystemId
      ? await getGameDesignSystemDetail(supabase, body.baseSystemId, { versionClient: getSupabaseServiceRoleClient() })
      : null;
    if (body.baseSystemId && !base?.current_version) {
      return NextResponse.json({ error: 'Base Game Design System has no usable version.' }, { status: 404 });
    }
    if (base && base.source !== 'official' && base.owner_id !== user.id) {
      return NextResponse.json({
        error: 'Only official or owned Game Design Systems can be used as a base.',
      }, { status: 403 });
    }
    const input: ResolvedGameDesignGenerationInput = {
      title: body.title,
      genres: body.genres,
      philosophies: body.philosophies,
      description: body.description,
      suitableFor: body.suitableFor,
      sourceSnapshots,
      referenceGames: body.referenceGames.map((game) => ({ name: game.name!, reference: game.reference!, avoid: game.avoid! })),
      baseSystemId: base?.id,
      baseVersionId: base?.current_version?.id,
      baseRules: base?.current_version?.rules,
      pastedMarkdown: body.pastedMarkdown,
    };
    const job = await createGameDesignSystemGenerationJob(
      getSupabaseServiceRoleClient(),
      user.id,
      input as never,
      { idempotencyKey: key, inputHash: hashResolvedGenerationInput(input) },
    );
    if (job.status === 'queued') scheduleWorker();
    return NextResponse.json({ job }, { status: 202 });
  } catch (error) {
    if (error instanceof IdempotencyConflictError) {
      return NextResponse.json({ error: 'Idempotency key was already used with a different payload.' }, { status: 409 });
    }
    if (error instanceof SourceSnapshotInputError) {
      return NextResponse.json({
        error: 'Invalid generation request.',
        issues: {
          formErrors: [],
          fieldErrors: { [error.field]: [error.message] },
        },
      }, { status: 400 });
    }
    console.error('[POST /api/game-design-systems/generation-jobs]', error);
    return NextResponse.json({ error: 'Failed to start generation.' }, { status: 400 });
  }
});
