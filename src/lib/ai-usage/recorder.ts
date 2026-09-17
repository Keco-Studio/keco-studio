import type { AiUsageAttempt, AiUsageMetadata, AiUsageRecorder } from './types';

type AuthenticatedUsageClient = {
  rpc: (name: string, args: { p_event: Record<string, unknown> }) => PromiseLike<{ error: unknown }>;
};

type ServiceUsageClient = {
  from: (table: 'ai_usage_events') => {
    upsert: (
      row: Record<string, unknown>,
      options: { onConflict: string; ignoreDuplicates: boolean },
    ) => Promise<{ error: unknown }>;
  };
};

const metadataStringKeys = new Set(['fixture', 'source', 'providerOperation']);
const metadataIntegerBounds: Record<string, number> = {
  iteration: 1000,
  repairAttempt: 1000,
  retryAttempt: 1000,
  batchSize: 10000,
  inputCharacters: 10000000,
  regionColumn: 65535,
  regionRow: 65535,
  regionColumns: 65535,
  regionRows: 65535,
  sceneIndex: 65535,
};
const metadataIdentifier = /^[a-z][a-z0-9_]{0,63}$/;

function bounded(value: string | undefined, limit: number): string | null {
  if (!value) return null;
  return value.slice(0, limit) || null;
}

function serializeMetadata(metadata: AiUsageMetadata | undefined): AiUsageMetadata {
  if (!metadata) return {};
  const safe: AiUsageMetadata = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (metadataStringKeys.has(key) && typeof value === 'string' && metadataIdentifier.test(value)) {
      safe[key] = value;
    } else if (key === 'embeddingType' && (value === 'index_batch' || value === 'query')) {
      safe[key] = value;
    } else if (
      key in metadataIntegerBounds
      && typeof value === 'number'
      && Number.isSafeInteger(value)
      && value >= 0
      && value <= metadataIntegerBounds[key]
    ) {
      safe[key] = value;
    }
  }
  return safe;
}

function pricingRuleVersion(attempt: AiUsageAttempt): number | null {
  return attempt.provider === 'deepseek'
    && attempt.requestKind === 'chat_completion'
    && attempt.usage
    ? 1
    : null;
}

function authenticatedEvent(attempt: AiUsageAttempt): Record<string, unknown> {
  return {
    ...attempt,
    model: bounded(attempt.model ?? undefined, 256),
    providerRequestId: bounded(attempt.providerRequestId, 256),
    metadata: serializeMetadata(attempt.metadata),
    pricingRuleVersion: pricingRuleVersion(attempt),
  };
}

function serviceRow(attempt: AiUsageAttempt): Record<string, unknown> {
  const usage = attempt.usage;
  return {
    event_key: attempt.eventKey,
    user_id: attempt.context.actorUserId,
    project_id: bounded(attempt.context.projectId, 256),
    feature: bounded(attempt.context.feature, 100),
    operation: bounded(attempt.context.operation, 100),
    request_kind: attempt.requestKind,
    provider: attempt.provider,
    model: bounded(attempt.model ?? undefined, 256),
    correlation_id: bounded(attempt.context.correlationId, 256),
    job_id: bounded(attempt.context.jobId, 256),
    artifact_id: bounded(attempt.context.artifactId, 256),
    attempt: attempt.attempt,
    provider_request_id: bounded(attempt.providerRequestId, 256),
    outcome: attempt.outcome,
    usage_status: usage ? 'reported' : 'unknown',
    input_tokens: usage?.inputTokens ?? null,
    output_tokens: usage?.outputTokens ?? null,
    total_tokens: usage?.totalTokens ?? null,
    provider_credits: attempt.providerCredits ?? null,
    pricing_rule_version: pricingRuleVersion(attempt),
    started_at: attempt.startedAt,
    finished_at: attempt.finishedAt,
    metadata: serializeMetadata(attempt.metadata),
  };
}

function persistenceErrorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    return error.code.slice(0, 64);
  }
  return 'unknown';
}

function logFailure(attempt: AiUsageAttempt, error: unknown): void {
  console.error('ai_usage_ledger_write_failed', {
    eventKey: attempt.eventKey,
    provider: attempt.provider,
    feature: attempt.context.feature.slice(0, 100),
    operation: attempt.context.operation.slice(0, 100),
    persistenceErrorCode: persistenceErrorCode(error),
  });
}

export function createAuthenticatedAiUsageRecorder(client: AuthenticatedUsageClient): AiUsageRecorder {
  return async (attempt) => {
    try {
      const { error } = await client.rpc('record_ai_usage_event', { p_event: authenticatedEvent(attempt) });
      if (error) logFailure(attempt, error);
    } catch (error) {
      logFailure(attempt, error);
    }
  };
}

export function createServiceAiUsageRecorder(client: ServiceUsageClient): AiUsageRecorder {
  return async (attempt) => {
    try {
      const { error } = await client.from('ai_usage_events').upsert(serviceRow(attempt), {
        onConflict: 'event_key',
        ignoreDuplicates: true,
      });
      if (error) logFailure(attempt, error);
    } catch (error) {
      logFailure(attempt, error);
    }
  };
}
