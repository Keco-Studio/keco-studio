import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('undici', () => ({
  Agent: class TestAgent {},
  EnvHttpProxyAgent: class TestEnvHttpProxyAgent {},
  fetch: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args),
}));

describe('LLM retry policy', () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.LLM_API_KEY;
  const originalApiUrl = process.env.LLM_API_URL;

  function restoreEnv(key: 'LLM_API_KEY' | 'LLM_API_URL', value: string | undefined) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  beforeEach(() => {
    jest.resetModules();
    process.env.LLM_API_KEY = 'test-key';
    process.env.LLM_API_URL = 'https://llm.test';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    restoreEnv('LLM_API_KEY', originalApiKey);
    restoreEnv('LLM_API_URL', originalApiUrl);
    jest.resetModules();
    jest.restoreAllMocks();
  });

  it('retries only rate limits and server errors', async () => {
    const { isRetriableStatus } = await import('../../../src/lib/agent/llm-client');

    expect(isRetriableStatus(400)).toBe(false);
    expect(isRetriableStatus(401)).toBe(false);
    expect(isRetriableStatus(403)).toBe(false);
    expect(isRetriableStatus(422)).toBe(false);
    expect(isRetriableStatus(429)).toBe(true);
    expect(isRetriableStatus(500)).toBe(true);
    expect(isRetriableStatus(503)).toBe(true);
  });

  it('does not retry non-retriable 4xx responses', async () => {
    global.fetch = jest.fn(async () => new Response('bad request', { status: 400 })) as typeof fetch;

    const { streamLlm } = await import('../../../src/lib/agent/llm-client');

    await expect(async () => {
      for await (const _chunk of streamLlm([{ role: 'user', content: 'hello' }])) {
        // consume stream
      }
    }).rejects.toThrow(/400/);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('does not retry aborted requests', async () => {
    global.fetch = jest.fn(async () => {
      throw new DOMException('aborted', 'AbortError');
    }) as typeof fetch;
    const abortController = new AbortController();
    abortController.abort();

    const { streamLlm } = await import('../../../src/lib/agent/llm-client');

    await expect(async () => {
      for await (const _chunk of streamLlm(
        [{ role: 'user', content: 'hello' }],
        { signal: abortController.signal }
      )) {
        // consume stream
      }
    }).rejects.toThrow(/aborted/);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
