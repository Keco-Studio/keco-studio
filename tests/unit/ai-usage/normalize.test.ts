import { creditsForTokenTotal, normalizeTokenUsage } from '@/lib/ai-usage/normalize';
import { deriveAiUsageBinding } from '@/lib/ai-usage/types';

it('normalizes provider totals without treating limits as usage', () => {
  expect(normalizeTokenUsage({ prompt_tokens: 10, completion_tokens: 11, total_tokens: 21 }))
    .toEqual({ inputTokens: 10, outputTokens: 11, totalTokens: 21 });
  expect(normalizeTokenUsage({ prompt_tokens: 10, completion_tokens: 11 }))
    .toEqual({ inputTokens: 10, outputTokens: 11, totalTokens: 21 });
  expect(normalizeTokenUsage({ total_tokens: -1 })).toBeNull();
  expect(normalizeTokenUsage({ prompt_tokens: 10, completion_tokens: 11, total_tokens: 20 }))
    .toBeNull();
  expect(normalizeTokenUsage(undefined)).toBeNull();
});

it('preserves DeepSeek cache hit and miss tokens when they match the input total', () => {
  expect(normalizeTokenUsage({
    prompt_tokens: 100,
    completion_tokens: 20,
    total_tokens: 120,
    prompt_cache_hit_tokens: 40,
    prompt_cache_miss_tokens: 60,
  })).toEqual({
    inputTokens: 100,
    outputTokens: 20,
    totalTokens: 120,
    inputCacheHitTokens: 40,
    inputCacheMissTokens: 60,
  });

  expect(normalizeTokenUsage({
    prompt_tokens: 100,
    completion_tokens: 20,
    total_tokens: 120,
    prompt_cache_hit_tokens: 41,
    prompt_cache_miss_tokens: 60,
  })).toBeNull();
});

it('normalizes input-only embedding usage without making embeddings billable', () => {
  expect(normalizeTokenUsage({ prompt_tokens: 8, total_tokens: 8 }, 'embedding'))
    .toEqual({ inputTokens: 8, outputTokens: 0, totalTokens: 8 });
  expect(normalizeTokenUsage({ prompt_tokens: 8, total_tokens: 8 }))
    .toBeNull();
});

it('rounds once after aggregating all DeepSeek tokens', () => {
  expect(creditsForTokenTotal(10n + 11n)).toBe(7n);
  expect(creditsForTokenTotal(0n)).toBe(0n);
});

it('derives a binding without losing recorder, context, or bounded metadata', () => {
  const recorder = jest.fn(async () => undefined);
  const parent = {
    context: {
      actorUserId: 'user-1',
      projectId: 'project-1',
      feature: 'gdd',
      operation: 'quick_generate',
      correlationId: 'job-1',
    },
    recorder,
    metadata: { source: 'worker' },
  };

  expect(deriveAiUsageBinding(parent, {
    operation: 'quick_repair',
    artifactId: 'artifact-1',
    metadata: { repairAttempt: 1 },
  })).toEqual({
    context: {
      ...parent.context,
      operation: 'quick_repair',
      artifactId: 'artifact-1',
    },
    recorder,
    metadata: { source: 'worker', repairAttempt: 1 },
  });
});
