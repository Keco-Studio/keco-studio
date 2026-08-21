import { after, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { withAuth } from '@/lib/auth/route-auth';
import { resolveGameDesignSourceSnapshots, SourceSnapshotInputError } from '@/lib/game-design-system/sourceSnapshots';
import { gameDesignGenerationRequestSchema } from '@/lib/game-design-system/generationRequest';
import { compileGameArtStyle, GameArtStyleCompilationError } from '@/lib/game-art-style/compiler';
import { hashResolvedGenerationInput, type ResolvedGameDesignGenerationInput } from '@/lib/gameDesignSystemGeneration';
import { getGameDesignSystemDetail, createGameDesignSystemGenerationJob, IdempotencyConflictError, publicGameDesignSystemGenerationJob } from '@/lib/services/gameDesignSystemService';
import { getSupabaseServiceRoleClient } from '@/lib/server/supabaseServiceRole';
import { processNextGameDesignSystemJob } from '@/lib/game-design-system/worker';

export const maxDuration = 120;

function idempotencyKey(request: Request): string | null {
  const value = request.headers.get('idempotency-key')?.trim();
  return value && /^[A-Za-z0-9._:-]{8,128}$/.test(value) ? value : null;
}

function generationRequestIssues(error: { flatten: () => { formErrors: string[]; fieldErrors: object }; issues: Array<{ code: string; path: PropertyKey[]; keys?: string[]; message: string }> }) {
  const issues = error.flatten();
  const fieldErrors = issues.fieldErrors as Record<string, string[] | undefined>;
  for (const issue of error.issues) {
    if (issue.code !== 'unrecognized_keys' || issue.path.length !== 0) continue;
    for (const key of issue.keys ?? []) fieldErrors[key] = [issue.message];
  }
  return issues;
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
  const parsed = gameDesignGenerationRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid generation request.', issues: generationRequestIssues(parsed.error) }, { status: 400 });
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
      ? await getGameDesignSystemDetail(supabase, body.baseSystemId, { snapshotClient: getSupabaseServiceRoleClient() })
      : null;
    if (body.baseSystemId && !base?.current_version) {
      return NextResponse.json({
        error: 'Base Game Design System has no usable version.',
        code: 'GDS_NOT_FOUND',
      }, { status: 404 });
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
      artStyle: compileGameArtStyle(body.artStyle),
      baseSystemId: base?.id,
      baseVersionId: base?.current_version?.id,
      baseDocument: base?.current_version?.document,
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
    return NextResponse.json({ job: publicGameDesignSystemGenerationJob(job) }, { status: 202 });
  } catch (error) {
    if (error instanceof IdempotencyConflictError) {
      return NextResponse.json({
        error: 'Idempotency key was already used with a different payload.',
        code: 'IDEMPOTENCY_CONFLICT',
      }, { status: 409 });
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
    if (error instanceof GameArtStyleCompilationError) {
      return NextResponse.json({
        error: 'Invalid generation request.',
        issues: { formErrors: [], fieldErrors: { artStyle: [error.message] } },
      }, { status: 400 });
    }
    console.error('[POST /api/game-design-systems/generation-jobs]', error);
    return NextResponse.json({ error: 'Failed to start generation.' }, { status: 400 });
  }
});
