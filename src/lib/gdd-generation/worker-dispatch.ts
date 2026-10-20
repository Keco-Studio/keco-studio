import 'server-only';

export type GddWorkerKind = 'gdd' | 'resource' | 'map';
export const MAX_GDD_WORKER_DELAY_MS = 35_000;

function workerUrl(): string {
  const deployment = process.env.VERCEL_URL?.trim();
  const base = deployment ? `https://${deployment}`
    : process.env.NODE_ENV !== 'production' ? `http://localhost:${process.env.PORT || '3000'}`
      : process.env.NEXT_PUBLIC_SITE_URL?.trim() || '';
  if (!base) throw new Error('GDD worker dispatch is not configured.');
  const url = new URL('/api/internal/game-design-system-worker', base);
  if (url.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && url.hostname === 'localhost')) {
    throw new Error('GDD worker dispatch URL is invalid.');
  }
  return url.toString();
}

export async function dispatchGddWorker(options: { kind?: GddWorkerKind; delayMs?: number } = {}): Promise<void> {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Error('GDD worker dispatch is not configured.');
  const kind = options.kind ?? 'gdd';
  const delayMs = options.delayMs ?? 0;
  if (!Number.isSafeInteger(delayMs) || delayMs < 0 || delayMs > MAX_GDD_WORKER_DELAY_MS) {
    throw new Error('GDD worker dispatch delay is invalid.');
  }
  const response = await fetch(workerUrl(), {
    method: 'POST',
    headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
    body: JSON.stringify({ kind, delayMs }),
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`GDD worker dispatch failed (${response.status}).`);
}
