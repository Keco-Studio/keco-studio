import { describe, expect, it } from '@jest/globals';
import { sseResponse } from '../../../src/lib/agent/sse';
import type { SSEEvent } from '../../../src/lib/agent/types';

describe('sseResponse abort handling', () => {
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
});
