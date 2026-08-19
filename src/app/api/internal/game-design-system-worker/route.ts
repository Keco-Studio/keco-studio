import { randomUUID, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getSupabaseServiceRoleClient } from '@/lib/server/supabaseServiceRole';
import { processNextGameDesignSystemJob } from '@/lib/game-design-system/worker';
import { processNextGddJob } from '@/lib/gdd-generation/worker';
import { processNextGddMapArtifact } from '@/lib/gdd-generation/maps/worker';

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
  for (let index = 0; index < 3; index += 1) {
    const workerId = `cron-${randomUUID()}`;
    const primary = index % 3 === 0 ? 'system' : index % 3 === 1 ? 'gdd' : 'gdd-map';
    const first = primary === 'system'
      ? await processNextGameDesignSystemJob({ serviceClient, workerId })
      : primary === 'gdd'
        ? await processNextGddJob({ serviceClient, workerId })
        : await processNextGddMapArtifact({ serviceClient, workerId });
    if (first.claimed) {
      results.push({ type: primary, ...first });
      continue;
    }
    const fallback = primary === 'system'
      ? await processNextGddJob({ serviceClient, workerId })
      : primary === 'gdd'
        ? await processNextGddMapArtifact({ serviceClient, workerId })
        : await processNextGameDesignSystemJob({ serviceClient, workerId });
    results.push({ type: primary === 'system' ? 'gdd' : primary === 'gdd' ? 'gdd-map' : 'system', ...fallback });
    if (!fallback.claimed) break;
  }
  return NextResponse.json({ results });
}
