import { afterEach, describe, expect, it, jest } from '@jest/globals';

const fetchMock = jest.fn(async () => new Response('ok', { status: 200 }));
const dispatcherOptions: Record<string, unknown>[] = [];

jest.mock('undici', () => ({
  Agent: class TestAgent {
    kind = 'agent';
  },
  EnvHttpProxyAgent: class TestEnvHttpProxyAgent {
    kind = 'env-proxy';
    constructor(options: Record<string, unknown>) {
      dispatcherOptions.push(options);
    }
  },
  fetch: (...args: unknown[]) => fetchMock(...(args as [])),
}));

describe('outboundFetch', () => {
  afterEach(() => {
    fetchMock.mockClear();
    dispatcherOptions.length = 0;
    jest.resetModules();
  });

  it('routes requests through undici with an EnvHttpProxyAgent dispatcher', async () => {
    const { outboundFetch, getOutboundDispatcher, resetOutboundDispatcherForTests } =
      await import('../../../src/lib/agent/outbound-http');
    resetOutboundDispatcherForTests();

    const dispatcher = getOutboundDispatcher();
    expect(dispatcher).toEqual(expect.objectContaining({ kind: 'env-proxy' }));

    await outboundFetch('https://api.example.test/v1', {
      method: 'POST',
      body: '{}',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, { dispatcher?: unknown }];
    expect(init.dispatcher).toBe(dispatcher);
  });

  it('keeps provider response timeouts longer than the professional GDD deadline', async () => {
    const { getOutboundDispatcher, resetOutboundDispatcherForTests } =
      await import('../../../src/lib/agent/outbound-http');
    resetOutboundDispatcherForTests();

    getOutboundDispatcher();

    expect(dispatcherOptions[0]).toEqual(expect.objectContaining({
      headersTimeout: 300_000,
      bodyTimeout: 300_000,
    }));
  });
});
