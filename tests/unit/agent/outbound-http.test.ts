import { afterEach, describe, expect, it, jest } from '@jest/globals';

const fetchMock = jest.fn(async () => new Response('ok', { status: 200 }));

jest.mock('undici', () => ({
  Agent: class TestAgent {
    kind = 'agent';
  },
  EnvHttpProxyAgent: class TestEnvHttpProxyAgent {
    kind = 'env-proxy';
  },
  fetch: (...args: unknown[]) => fetchMock(...(args as [])),
}));

describe('outboundFetch', () => {
  afterEach(() => {
    fetchMock.mockClear();
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
});
