import { randomUUID, timingSafeEqual } from 'node:crypto';
import { after, NextResponse } from 'next/server';
import { getSupabaseServiceRoleClient } from '@/lib/server/supabaseServiceRole';
import { processNextGameDesignSystemJob } from '@/lib/game-design-system/worker';
import { processNextGddJob } from '@/lib/gdd-generation/worker';
import { processNextDialogueJob } from '@/lib/gdd-generation/dialogueWorker';
import { processNextGddMapArtifact } from '@/lib/gdd-generation/maps/worker';
import { processNextGddResourceJob } from '@/lib/gdd-generation/resources/worker';
import { dispatchGddWorker, MAX_GDD_WORKER_DELAY_MS, type GddWorkerKind } from '@/lib/gdd-generation/worker-dispatch';

export const maxDuration = 300;

function authorized(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  const supplied = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!expected || !supplied) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'Worker is not configured.' }, { status: 503 });
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }
  const results = [];
  const serviceClient = getSupabaseServiceRoleClient();
  const workers = [
    { type: 'system', run: processNextGameDesignSystemJob },
    { type: 'gdd', run: processNextGddJob },
    { type: 'dialogue', run: processNextDialogueJob },
    { type: 'gdd-resource', run: processNextGddResourceJob },
    { type: 'gdd-map', run: processNextGddMapArtifact },
  ] as const;
  let gddStageProcessed = false;
  for (let index = 0; index < 4; index += 1) {
    const workerId = `cron-${randomUUID()}`;
    let claimed = false;
    for (let offset = 0; offset < workers.length; offset += 1) {
      const worker = workers[(index + offset) % workers.length];
      if (worker.type === 'gdd' && gddStageProcessed) continue;
      const result = await worker.run({ serviceClient, workerId });
      if (!result.claimed && offset < workers.length - 1) continue;
      results.push({ type: worker.type, ...result });
      claimed = result.claimed;
      if (worker.type === 'gdd' && result.claimed) gddStageProcessed = true;
      break;
    }
    if (!claimed && index === 0) break;
  }
  return NextResponse.json({ results });
}

export async function POST(request: Request) {
  if (!process.env.CRON_SECRET) return NextResponse.json({ error: 'Worker is not configured.' }, { status: 503 });
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { kind?: unknown; delayMs?: unknown };
  const kind = body.kind ?? 'gdd';
  const delayMs = body.delayMs ?? 0;
  if ((kind !== 'gdd' && kind !== 'resource' && kind !== 'map') ||
      !Number.isSafeInteger(delayMs) || (delayMs as number) < 0 || (delayMs as number) > MAX_GDD_WORKER_DELAY_MS) {
    return NextResponse.json({ error: 'Invalid worker request.' }, { status: 400 });
  }
  after(async () => {
    try {
      if (delayMs) await new Promise<void>((resolve) => setTimeout(resolve, delayMs as number));
      const selected = kind as GddWorkerKind;
      if (delayMs) {
        await dispatchGddWorker({ kind: selected, delayMs: 0 });
        return;
      }
      const serviceClient = getSupabaseServiceRoleClient();
      const workerId = `gdd-dispatch-${randomUUID()}`;
      const worker = selected === 'gdd' ? processNextGddJob
        : selected === 'resource' ? processNextGddResourceJob : processNextGddMapArtifact;
      const result = await worker({ serviceClient, workerId });
      if (!result.claimed) return;
      const id = 'jobId' in result ? result.jobId : 'artifactId' in result ? result.artifactId : undefined;
      if (result.status === 'queued' && id) {
        const table = selected === 'gdd' ? 'gdd_generation_jobs'
          : selected === 'resource' ? 'gdd_resource_jobs' : 'gdd_map_artifacts';
        const { data, error } = await serviceClient.from(table).select('available_at').eq('id', id).maybeSingle();
        if (error) throw error;
        const next = data?.available_at ? Math.max(0, Date.parse(data.available_at) - Date.now() + 250) || 0 : 0;
        await dispatchGddWorker({ kind: selected, delayMs: Math.min(next, MAX_GDD_WORKER_DELAY_MS) });
      } else if (selected === 'gdd' &&
          (result.status === 'completed' || result.status === 'completed_with_map_failures')) {
        await dispatchGddWorker({ kind: 'resource', delayMs: 0 });
      } else if (selected === 'gdd' && result.status === 'waiting_for_maps') {
        await dispatchGddWorker({ kind: 'map', delayMs: 0 });
      } else if (selected === 'resource') {
        await dispatchGddWorker({ kind: 'resource', delayMs: 0 });
      } else if (selected === 'map') {
        await dispatchGddWorker({ kind: 'map', delayMs: 0 });
      }
      if (selected === 'resource' && result.status === 'completed') {
        await dispatchGddWorker({ kind: 'map', delayMs: 0 });
      }
    } catch (error) {
      console.error('[GDD dispatched worker]', error instanceof Error ? error.message : 'Unknown error');
    }
  });
  return NextResponse.json({ accepted: true }, { status: 202 });
}
