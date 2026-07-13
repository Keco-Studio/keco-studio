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
    for await (const chunk of streamLlm(
      [{ role: 'user', content: 'hello' }],
      { maxTokens: 1234, thinking: 'disabled' } as never
    )) {
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
      thinking: { type: 'disabled' },
    });
  });

  it('serializes maxCompletionTokens to the preferred provider field', async () => {
    jest.resetModules();
    process.env.LLM_API_KEY = 'test-key';
    process.env.LLM_API_URL = 'https://llm.test';

    global.fetch = jest.fn(async () => new Response(
      'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
      { status: 200 }
    )) as typeof fetch;

    const { streamLlm } = await import('../../../src/lib/agent/llm-client');
    for await (const _chunk of streamLlm(
      [{ role: 'user', content: 'hello' }],
      { maxCompletionTokens: 4321 } as never
    )) {
      // Consume the response so the request body can be asserted.
    }

    const [, init] = (global.fetch as jest.MockedFunction<typeof fetch>).mock.calls[0];
    expect(JSON.parse(String(init?.body))).toMatchObject({
      max_completion_tokens: 4321,
    });
    expect(JSON.parse(String(init?.body))).not.toHaveProperty('max_tokens');
  });

  it('reports sanitized upstream response metadata through an optional callback', async () => {
    jest.resetModules();
    process.env.LLM_API_KEY = 'test-key';
    process.env.LLM_API_URL = 'https://llm.test';
    const onResponseMetadata = jest.fn();
    global.fetch = jest.fn(async () => new Response(
      'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
      { status: 200, headers: { 'x-request-id': 'request-123' } }
    )) as typeof fetch;

    const { completeLlm } = await import('../../../src/lib/agent/llm-client');
    await completeLlm(
      [{ role: 'user', content: 'hello' }],
      { onResponseMetadata } as never
    );

    expect(onResponseMetadata).toHaveBeenCalledWith({
      status: 200,
      requestId: 'request-123',
    });
    expect(JSON.stringify(onResponseMetadata.mock.calls)).not.toContain('test-key');
    expect(JSON.stringify(onResponseMetadata.mock.calls)).not.toContain('hello');
  });

  it('forces a named output tool and returns its streamed JSON arguments', async () => {
    jest.resetModules();
    process.env.LLM_API_KEY = 'test-key';
    process.env.LLM_API_URL = 'https://llm.test';

    const events = [
      {
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              id: 'call-1',
              function: { name: 'submit_story_ir', arguments: '{"version":' },
            }],
          },
          finish_reason: null,
        }],
      },
      {
        choices: [{
          delta: {
            tool_calls: [{ index: 0, function: { arguments: '1}' } }],
          },
          finish_reason: 'tool_calls',
        }],
      },
    ];
    global.fetch = jest.fn(async () => new Response(
      `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')}data: [DONE]\n\n`,
      { status: 200 }
    )) as typeof fetch;

    const { completeLlm } = await import('../../../src/lib/agent/llm-client');
    const tool = {
      type: 'function',
      function: {
        name: 'submit_story_ir',
        description: 'Submit Story IR',
        parameters: { type: 'object' },
      },
    } as const;
    const result = await completeLlm(
      [{ role: 'user', content: 'convert' }],
      { tools: [tool], toolName: 'submit_story_ir' } as never
    );

    expect(result).toBe('{"version":1}');
    const [, init] = (global.fetch as jest.MockedFunction<typeof fetch>).mock.calls[0];
    expect(JSON.parse(String(init?.body))).toMatchObject({
      tools: [tool],
      tool_choice: { type: 'function', function: { name: 'submit_story_ir' } },
    });
  });

  it('rejects provider-aborted tool output instead of returning partial JSON', async () => {
    jest.resetModules();
    process.env.LLM_API_KEY = 'test-key';
    process.env.LLM_API_URL = 'https://llm.test';

    const event = {
      choices: [{
        delta: {
          tool_calls: [{
            index: 0,
            id: 'call-1',
            function: { name: 'submit_story_plan', arguments: '{"version":2' },
          }],
        },
        finish_reason: 'abort',
      }],
    };
    global.fetch = jest.fn(async () => new Response(
      `data: ${JSON.stringify(event)}\n\ndata: [DONE]\n\n`,
      { status: 200 }
    )) as typeof fetch;

    const { completeLlm } = await import('../../../src/lib/agent/llm-client');
    await expect(completeLlm(
      [{ role: 'user', content: 'convert' }],
      {
        tools: [{
          type: 'function',
          function: {
            name: 'submit_story_plan',
            description: 'Submit plan',
            parameters: { type: 'object' },
          },
        }],
        toolName: 'submit_story_plan',
      } as never
    )).rejects.toThrow(/abort/i);
  });

  it('accepts a plain JSON object when MiniMax skips the required tool envelope', async () => {
    jest.resetModules();
    process.env.LLM_API_KEY = 'test-key';
    process.env.LLM_API_URL = 'https://llm.test';

    global.fetch = jest.fn(async () => new Response(
      'data: {"choices":[{"delta":{"content":"{\\"verdict\\":\\"pass\\",\\"issues\\":[]}"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
      { status: 200 }
    )) as typeof fetch;

    const { completeLlm } = await import('../../../src/lib/agent/llm-client');
    await expect(completeLlm(
      [{ role: 'user', content: 'audit' }],
      { tools: [], toolName: 'submit_story_plan_audit' } as never
    )).resolves.toBe('{"verdict":"pass","issues":[]}');
  });

  it('still rejects plain prose when the required tool envelope is missing', async () => {
    jest.resetModules();
    process.env.LLM_API_KEY = 'test-key';
    process.env.LLM_API_URL = 'https://llm.test';

    global.fetch = jest.fn(async () => new Response(
      'data: {"choices":[{"delta":{"content":"The candidate passes."},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
      { status: 200 }
    )) as typeof fetch;

    const { completeLlm } = await import('../../../src/lib/agent/llm-client');
    await expect(completeLlm(
      [{ role: 'user', content: 'audit' }],
      { tools: [], toolName: 'submit_story_plan_audit' } as never
    )).rejects.toThrow(/did not call required tool/i);
  });
});
