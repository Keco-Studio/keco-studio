import { randomUUID, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getSupabaseServiceRoleClient } from '@/lib/server/supabaseServiceRole';
import { processNextGameDesignSystemJob } from '@/lib/game-design-system/worker';
import { processNextGddJob } from '@/lib/gdd-generation/worker';
import { processNextDialogueJob } from '@/lib/gdd-generation/dialogueWorker';

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
  ] as const;
  for (let index = 0; index < 3; index += 1) {
    const workerId = `cron-${randomUUID()}`;
    let claimed = false;
    for (let offset = 0; offset < workers.length; offset += 1) {
      const worker = workers[(index + offset) % workers.length];
      const result = await worker.run({ serviceClient, workerId });
      if (!result.claimed && offset < workers.length - 1) continue;
      results.push({ type: worker.type, ...result });
      claimed = result.claimed;
      break;
    }
    if (!claimed && index === 0) break;
  }
  return NextResponse.json({ results });
}
