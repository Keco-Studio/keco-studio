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
      status: 200,
      json: async () => ({ role: 'admin', isOwner: true }),
    } as Response);

    const result = await fetchProjectRoleWithRetry('project-id', 'token', {
      maxAttempts: 3,
      delayMs: 100,
    });

    expect(result).toEqual({ role: 'admin', isOwner: true });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('retries until role becomes available after 404', async () => {
    global.fetch = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ role: null, isOwner: false }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
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

  it('fails fast on 403 without retrying', async () => {
    global.fetch = jest.fn<typeof fetch>().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ role: null, isOwner: false }),
    } as Response);

    const result = await fetchProjectRoleWithRetry('project-id', 'token', {
      maxAttempts: 5,
      delayMs: 100,
    });

    expect(result).toEqual({ role: null, isOwner: false });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('fails fast on 401 without retrying', async () => {
    global.fetch = jest.fn<typeof fetch>().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ role: null, isOwner: false }),
    } as Response);

    const result = await fetchProjectRoleWithRetry('project-id', 'token', {
      maxAttempts: 5,
      delayMs: 100,
    });

    expect(result).toEqual({ role: null, isOwner: false });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('returns last null result after exhausting 404 retries', async () => {
    global.fetch = jest.fn<typeof fetch>().mockResolvedValue({
      ok: false,
      status: 404,
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
