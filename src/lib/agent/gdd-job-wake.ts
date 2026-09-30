import 'server-only';

import { dispatchGddWorker, MAX_GDD_WORKER_DELAY_MS, type GddWorkerKind } from '@/lib/gdd-generation/worker-dispatch';

export type GddWorkerWake = 'scheduled' | 'waiting_for_retry' | 'not_needed' | 'failed';

export async function wakeQueuedGddJob(job: { status: string; availableAt?: string }, kind: GddWorkerKind = 'gdd'): Promise<GddWorkerWake> {
  if (job.status !== 'queued') return 'not_needed';
  const delayMs = job.availableAt ? Math.max(0, Date.parse(job.availableAt) - Date.now() + 250) || 0 : 0;
  if (delayMs > MAX_GDD_WORKER_DELAY_MS) return 'waiting_for_retry';
  try {
    await dispatchGddWorker({ kind, delayMs });
    return 'scheduled';
  } catch (error) {
    console.error('[Assistant GDD worker dispatch]', error instanceof Error ? error.message : 'Unknown error');
    return 'failed';
  }
}
