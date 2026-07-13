import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { sseResponse } from '../../../src/lib/agent/sse';
import type { SSEEvent } from '../../../src/lib/agent/types';

describe('sseResponse abort handling', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('aborts the provided controller when the stream is cancelled', async () => {
    async function* generator(): AsyncGenerator<SSEEvent> {
      yield { type: 'text_delta', content: 'hello' };
      await new Promise<never>(() => {});
    }

    const abortController = new AbortController();
    const response = sseResponse(generator(), { abortController });
    const reader = response.body!.getReader();

    await reader.read();
    await reader.cancel();

    expect(abortController.signal.aborted).toBe(true);
  });

  it('emits SSE keepalive comments while the generator is idle', async () => {
    jest.useFakeTimers();
    async function* generator(): AsyncGenerator<SSEEvent> {
      await new Promise<never>(() => {});
    }

    const response = sseResponse(generator(), { heartbeatIntervalMs: 1_000 });
    const reader = response.body!.getReader();
    const pendingRead = reader.read();

    await jest.advanceTimersByTimeAsync(1_000);

    const { value } = await pendingRead;
    expect(new TextDecoder().decode(value)).toBe(': keepalive\n\n');
    await reader.cancel();
  });
});
