jest.mock('server-only', () => ({}));

import { dispatchGddWorker } from '@/lib/gdd-generation/worker-dispatch';

const oldSecret = process.env.CRON_SECRET;
const oldVercelUrl = process.env.VERCEL_URL;
const oldSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;
const oldPort = process.env.PORT;

afterAll(() => {
  process.env.CRON_SECRET = oldSecret;
  process.env.VERCEL_URL = oldVercelUrl;
  process.env.NEXT_PUBLIC_SITE_URL = oldSiteUrl;
  process.env.PORT = oldPort;
});

it('uses the local worker in development even when a public site URL is configured', async () => {
  process.env.CRON_SECRET = 'worker-secret';
  delete process.env.VERCEL_URL;
  process.env.NEXT_PUBLIC_SITE_URL = 'https://production.example.test';
  process.env.PORT = '3100';
  const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce({ ok: true } as Response);
  try {
    await dispatchGddWorker();
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3100/api/internal/game-design-system-worker', expect.anything());
  } finally {
    fetchMock.mockRestore();
  }
});

it('sends an authenticated short request to the current deployment', async () => {
  process.env.CRON_SECRET = 'worker-secret';
  process.env.VERCEL_URL = 'preview.example.test';
  const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce({ ok: true } as Response);
  try {
    await dispatchGddWorker();
    expect(fetchMock).toHaveBeenCalledWith('https://preview.example.test/api/internal/game-design-system-worker',
      expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ authorization: 'Bearer worker-secret' }),
        body: JSON.stringify({ kind: 'gdd', delayMs: 0 }) }));
  } finally {
    fetchMock.mockRestore();
  }
});

it('rejects a failed dispatch instead of silently leaving the job queued', async () => {
  process.env.CRON_SECRET = 'worker-secret';
  process.env.VERCEL_URL = 'preview.example.test';
  const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce({ ok: false, status: 503 } as Response);
  try {
    await expect(dispatchGddWorker()).rejects.toThrow('GDD worker dispatch failed');
  } finally {
    fetchMock.mockRestore();
  }
});
