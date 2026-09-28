import 'server-only';

import { randomUUID } from 'node:crypto';
import { after } from 'next/server';
import { processNextGameDesignSystemJob } from '@/lib/game-design-system/worker';
import { getSupabaseServiceRoleClient } from '@/lib/server/supabaseServiceRole';

/** Register within the agent request, so the response can return its queued job immediately. */
export function wakeQueuedGameDesignSystemJob(status: string): void {
  if (status !== 'queued') return;
  const work = async () => {
    try {
      await processNextGameDesignSystemJob({
        serviceClient: getSupabaseServiceRoleClient(),
        workerId: `assistant-${randomUUID()}`,
      });
    } catch (error) {
      console.error('[Assistant Game Design System worker]', error);
    }
  };
  try {
    after(work);
  } catch (error) {
    // Domain unit tests call the Tool without a Next request scope.
    if (process.env.NODE_ENV === 'test' && error instanceof Error &&
        error.message.includes('`after` was called outside a request scope')) return;
    throw error;
  }
}
