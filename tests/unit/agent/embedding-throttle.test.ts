import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import {
  acquireEmbeddingSlot,
  isRateLimitError,
  markEmbeddingRateLimited,
  resetEmbeddingThrottleForTests,
} from '../../../src/lib/agent/embedding-throttle';

describe('embedding-throttle', () => {
  beforeEach(() => {
    resetEmbeddingThrottleForTests();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('detects rate limit messages', () => {
    expect(isRateLimitError('rate limit exceeded(RPM)')).toBe(true);
    expect(isRateLimitError('invalid params')).toBe(false);
  });

  it('spaces embedding requests by the configured minimum interval', async () => {
    process.env.EMBEDDING_MIN_INTERVAL_MS = '1000';
    process.env.EMBEDDING_PROVIDER = 'openai';

    const first = acquireEmbeddingSlot();
    await first;

    const second = acquireEmbeddingSlot();
    const pending = second.then(() => 'ready');
    await jest.advanceTimersByTimeAsync(1000);
    await expect(pending).resolves.toBe('ready');
  });

  it('waits through cooldown after rate limit', async () => {
    process.env.EMBEDDING_RATE_LIMIT_COOLDOWN_MS = '5000';
    markEmbeddingRateLimited(1_000);

    const slot = acquireEmbeddingSlot();
    const pending = slot.then(() => 'ready');
    await jest.advanceTimersByTimeAsync(5000);
    await expect(pending).resolves.toBe('ready');
  });
});
