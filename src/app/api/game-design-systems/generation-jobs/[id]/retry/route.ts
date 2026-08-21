import { after, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { withAuth } from '@/lib/auth/route-auth';
import { createGameDesignSystemGenerationJob, getGameDesignSystemGenerationJob, IdempotencyConflictError, publicGameDesignSystemGenerationJob } from '@/lib/services/gameDesignSystemService';
import { hashResolvedGenerationInput, type ResolvedGameDesignGenerationInput } from '@/lib/gameDesignSystemGeneration';
import { getSupabaseServiceRoleClient } from '@/lib/server/supabaseServiceRole';
import { processNextGameDesignSystemJob } from '@/lib/game-design-system/worker';

type Params = { params: Promise<{ id: string }> };

export const POST = withAuth(async function POST(request, { params }: Params, { supabase, user }) {
  const key = request.headers.get('idempotency-key')?.trim();
  if (!key || !/^[A-Za-z0-9._:-]{8,128}$/.test(key)) {
    return NextResponse.json({ error: 'A valid Idempotency-Key header is required.' }, { status: 400 });
  }
  const { id } = await params;
  const previous = await getGameDesignSystemGenerationJob(supabase, id);
  if (!previous) {
    return NextResponse.json({ error: 'Generation job not found.', code: 'GDS_NOT_FOUND' }, { status: 404 });
  }
  if (previous.status !== 'failed') {
    return NextResponse.json({ error: 'Only failed jobs can be retried.', code: 'GDS_JOB_CONFLICT' }, { status: 409 });
  }
  const input = previous.input as unknown as ResolvedGameDesignGenerationInput;
  try {
    const job = await createGameDesignSystemGenerationJob(getSupabaseServiceRoleClient(), user.id, previous.input, {
      idempotencyKey: key,
      inputHash: hashResolvedGenerationInput(input),
    });
    after(async () => {
      try {
        await processNextGameDesignSystemJob({ serviceClient: getSupabaseServiceRoleClient(), workerId: `retry-${randomUUID()}` });
      } catch (error) {
        console.error('[Game Design System retry worker]', error);
      }
    });
    return NextResponse.json({ job: publicGameDesignSystemGenerationJob(job) }, { status: 202 });
  } catch (error) {
    const status = error instanceof IdempotencyConflictError ? 409 : 400;
    if (!(error instanceof IdempotencyConflictError)) {
      console.error('[POST /api/game-design-systems/generation-jobs/:id/retry]', error);
    }
    return NextResponse.json({
      error: error instanceof IdempotencyConflictError
        ? 'Idempotency key was already used with a different payload.'
        : 'Retry failed.',
      ...(error instanceof IdempotencyConflictError ? { code: 'IDEMPOTENCY_CONFLICT' } : {}),
    }, { status });
  }
});
