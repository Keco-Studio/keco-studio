import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { AiUsageBinding, AiUsageRecorder } from '@/lib/ai-usage/types';

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

  function binding(recorder: AiUsageRecorder): AiUsageBinding {
    return {
      context: {
        actorUserId: '00000000-0000-4000-8000-000000000002',
        feature: 'agent',
        operation: 'chat',
        correlationId: 'correlation-1',
      },
      recorder,
    };
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

  it.each([
    ['rate limits', 429],
    ['server failures', 503],
  ])('captures every %s attempt with unknown usage and a distinct key', async (_label, status) => {
    global.fetch = jest.fn(async () => new Response('transient', { status })) as typeof fetch;
    const recorder = jest.fn(async () => undefined);
    const { streamLlm } = await import('../../../src/lib/agent/llm-client');

    await expect(async () => {
      for await (const _chunk of streamLlm([{ role: 'user', content: 'hello' }], {
        provider: 'deepseek', usageBinding: binding(recorder),
      })) {
        // drain
      }
    }).rejects.toThrow();

    expect(recorder).toHaveBeenCalledTimes(3);
    const attempts = recorder.mock.calls.map(([event]) => event);
    expect(attempts).toEqual(expect.arrayContaining([
      expect.objectContaining({ outcome: 'provider_error', usage: null }),
    ]));
    expect(new Set(attempts.map((event) => event.eventKey)).size).toBe(3);
  });

  it('captures transport failures and aborts as one unknown-usage attempt each', async () => {
    const transportRecorder = jest.fn(async () => undefined);
    global.fetch = jest.fn(async () => { throw new TypeError('fetch failed'); }) as typeof fetch;
    const { streamLlm } = await import('../../../src/lib/agent/llm-client');

    await expect(async () => {
      for await (const _chunk of streamLlm([{ role: 'user', content: 'hello' }], {
        usageBinding: binding(transportRecorder),
      })) {
        // drain
      }
    }).rejects.toThrow();
    expect(transportRecorder).toHaveBeenCalledTimes(3);
    expect(transportRecorder.mock.calls[0][0]).toEqual(expect.objectContaining({
      outcome: 'transport_error', usage: null,
    }));

    const abortRecorder = jest.fn(async () => undefined);
    global.fetch = jest.fn(async () => { throw new DOMException('aborted', 'AbortError'); }) as typeof fetch;
    await expect(async () => {
      for await (const _chunk of streamLlm([{ role: 'user', content: 'hello' }], {
        usageBinding: binding(abortRecorder),
      })) {
        // drain
      }
    }).rejects.toThrow(/aborted/);
    expect(abortRecorder).toHaveBeenCalledTimes(1);
    expect(abortRecorder.mock.calls[0][0]).toEqual(expect.objectContaining({
      outcome: 'aborted', usage: null,
    }));
  });

  it('records each failed retry before the eventual successful attempt', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce(new Response('retry', { status: 503 }))
      .mockResolvedValueOnce(new Response(
        'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":2,"total_tokens":3}}\n\ndata: [DONE]\n\n',
        { status: 200 },
      )) as typeof fetch;
    const recorder = jest.fn(async () => undefined);
    const { streamLlm } = await import('../../../src/lib/agent/llm-client');

    for await (const _chunk of streamLlm([{ role: 'user', content: 'hello' }], {
      provider: 'deepseek', usageBinding: binding(recorder),
    })) {
      // drain
    }

    expect(recorder).toHaveBeenCalledTimes(2);
    expect(recorder.mock.calls.map(([event]) => event)).toEqual([
      expect.objectContaining({ attempt: 1, outcome: 'provider_error', usage: null }),
      expect.objectContaining({
        attempt: 2,
        outcome: 'succeeded',
        usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
      }),
    ]);
    expect(recorder.mock.calls[0][0].eventKey).not.toBe(recorder.mock.calls[1][0].eventKey);
  });
});
