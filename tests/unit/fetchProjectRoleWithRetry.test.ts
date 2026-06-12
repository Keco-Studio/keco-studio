import { describe, expect, it, jest, beforeEach, afterEach } from '@jest/globals';
import { fetchProjectRoleWithRetry } from '@/lib/utils/fetchProjectRoleWithRetry';

describe('fetchProjectRoleWithRetry', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
  });

  it('returns role immediately when first response includes role', async () => {
    global.fetch = jest.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      json: async () => ({ role: 'admin', isOwner: true }),
    } as Response);

    const result = await fetchProjectRoleWithRetry('project-id', 'token', {
      maxAttempts: 3,
      delayMs: 100,
    });

    expect(result).toEqual({ role: 'admin', isOwner: true });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('retries until role becomes available', async () => {
    global.fetch = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ role: null, isOwner: true }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ role: 'admin', isOwner: true }),
      } as Response);

    const promise = fetchProjectRoleWithRetry('project-id', 'token', {
      maxAttempts: 3,
      delayMs: 100,
    });

    await jest.advanceTimersByTimeAsync(100);
    const result = await promise;

    expect(result).toEqual({ role: 'admin', isOwner: true });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('returns last null result after exhausting retries', async () => {
    global.fetch = jest.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      json: async () => ({ role: null, isOwner: false }),
    } as Response);

    const promise = fetchProjectRoleWithRetry('project-id', 'token', {
      maxAttempts: 2,
      delayMs: 50,
    });

    await jest.advanceTimersByTimeAsync(50);
    const result = await promise;

    expect(result).toEqual({ role: null, isOwner: false });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
