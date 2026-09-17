import { expect, it, jest } from '@jest/globals';
import {
  createAuthenticatedAiUsageRecorder,
  createServiceAiUsageRecorder,
} from '@/lib/ai-usage/recorder';
import type { AiUsageAttempt } from '@/lib/ai-usage/types';

function attemptFixture(overrides: Partial<AiUsageAttempt> = {}): AiUsageAttempt {
  return {
    eventKey: '00000000-0000-4000-8000-000000000001',
    context: {
      actorUserId: '00000000-0000-4000-8000-000000000002',
      projectId: '00000000-0000-4000-8000-000000000003',
      feature: 'test_feature',
      operation: 'test_operation',
      correlationId: 'correlation-1',
      jobId: 'job-1',
      artifactId: 'artifact-1',
    },
    requestKind: 'chat_completion',
    provider: 'deepseek',
    model: 'deepseek-flash',
    attempt: 1,
    providerRequestId: 'request-1',
    outcome: 'succeeded',
    usage: { inputTokens: 10, outputTokens: 11, totalTokens: 21 },
    startedAt: '2026-09-15T00:00:00.000Z',
    finishedAt: '2026-09-15T00:00:01.000Z',
    metadata: { source: 'worker', retryAttempt: 0 },
    ...overrides,
  };
}

it('records authenticated attempts through the server-owned RPC without a user id', async () => {
  const rpc = jest.fn(async () => ({ error: null }));
  const recorder = createAuthenticatedAiUsageRecorder({ rpc } as never);

  await recorder(attemptFixture());

  expect(rpc).toHaveBeenCalledWith('record_ai_usage_event', {
    p_event: expect.not.objectContaining({ user_id: expect.anything() }),
  });
  expect(rpc.mock.calls[0][1]?.p_event).toEqual(expect.objectContaining({
    eventKey: '00000000-0000-4000-8000-000000000001',
    usage: { inputTokens: 10, outputTokens: 11, totalTokens: 21 },
  }));
});

it('contains authenticated persistence failures without logging provider details', async () => {
  const rpc = jest.fn(async () => ({ error: { code: 'XX000', message: 'private detail' } }));
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  const recorder = createAuthenticatedAiUsageRecorder({ rpc } as never);

  await expect(recorder(attemptFixture())).resolves.toBeUndefined();

  expect(errorSpy).toHaveBeenCalledWith('ai_usage_ledger_write_failed', expect.objectContaining({
    eventKey: '00000000-0000-4000-8000-000000000001',
    persistenceErrorCode: 'XX000',
  }));
  expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('private detail');
});

it('records service attempts with a duplicate-safe table upsert and snake-case tokens', async () => {
  const upsert = jest.fn(async () => ({ error: null }));
  const from = jest.fn(() => ({ upsert }));
  const recorder = createServiceAiUsageRecorder({ from } as never);

  await recorder(attemptFixture());

  expect(from).toHaveBeenCalledWith('ai_usage_events');
  expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
    event_key: '00000000-0000-4000-8000-000000000001',
    user_id: '00000000-0000-4000-8000-000000000002',
    input_tokens: 10,
    output_tokens: 11,
    total_tokens: 21,
    usage_status: 'reported',
    pricing_rule_version: 1,
  }), { onConflict: 'event_key', ignoreDuplicates: true });
});

it('bounds persisted diagnostic strings and only retains schema-safe metadata', async () => {
  const upsert = jest.fn(async () => ({ error: null }));
  const recorder = createServiceAiUsageRecorder({ from: jest.fn(() => ({ upsert })) } as never);

  await recorder(attemptFixture({
    model: 'm'.repeat(300),
    providerRequestId: 'r'.repeat(300),
    metadata: { source: 'Invalid Source!', retryAttempt: 1001 },
  }));

  expect(upsert.mock.calls[0][0]).toEqual(expect.objectContaining({
    model: 'm'.repeat(256),
    provider_request_id: 'r'.repeat(256),
    metadata: {},
  }));
});
