import { afterEach, describe, expect, it, jest } from '@jest/globals';

describe('streamLlm request options', () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.LLM_API_KEY;
  const originalApiUrl = process.env.LLM_API_URL;
  const originalModel = process.env.LLM_MODEL;

  function restoreEnv(key: 'LLM_API_KEY' | 'LLM_API_URL' | 'LLM_MODEL', value: string | undefined) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  afterEach(() => {
    global.fetch = originalFetch;
    restoreEnv('LLM_API_KEY', originalApiKey);
    restoreEnv('LLM_API_URL', originalApiUrl);
    restoreEnv('LLM_MODEL', originalModel);
    jest.resetModules();
    jest.restoreAllMocks();
  });

  it('serializes maxTokens to the provider max_tokens field', async () => {
    jest.resetModules();
    process.env.LLM_API_KEY = 'test-key';
    process.env.LLM_API_URL = 'https://llm.test';
    process.env.LLM_MODEL = 'test-model';

    global.fetch = jest.fn(async () =>
      new Response(
        [
          'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}],"usage":{"total_tokens":1}}',
          '',
          'data: [DONE]',
          '',
        ].join('\n'),
        { status: 200 }
      )
    ) as typeof fetch;

    const { streamLlm } = await import('../../../src/lib/agent/llm-client');
    const chunks = [];
    for await (const chunk of streamLlm([{ role: 'user', content: 'hello' }], { maxTokens: 1234 })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      { type: 'text_delta', content: 'ok' },
      { type: 'finish', reason: 'stop', usage: { total_tokens: 1 } },
    ]);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    const [, init] = (global.fetch as jest.MockedFunction<typeof fetch>).mock.calls[0];
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: 'test-model',
      max_tokens: 1234,
    });
  });
});
