export type EdgeAiUsageContext = {
  actorUserId: string;
  projectId?: string;
  feature: string;
  operation: string;
  correlationId: string;
  jobId?: string;
  artifactId?: string;
};

export type EdgeAiUsageAttempt = {
  eventKey: string;
  context: EdgeAiUsageContext;
  requestKind: "provider_generation";
  provider: "pixellab";
  model: null;
  attempt: number;
  providerRequestId?: string;
  outcome: "succeeded" | "provider_error" | "transport_error" | "aborted";
  usage: null;
  providerCredits?: number;
  startedAt: string;
  finishedAt: string;
  metadata?: { providerOperation?: string };
};

export type EdgeAiUsageRecorder = (attempt: EdgeAiUsageAttempt) => Promise<void>;

type ServiceUsageClient = {
  from: (table: "ai_usage_events") => {
    upsert: (
      row: Record<string, unknown>,
      options: { onConflict: string; ignoreDuplicates: boolean },
    ) => PromiseLike<{ error: unknown }>;
  };
};

function bounded(value: string | undefined, limit: number): string | null {
  if (!value) return null;
  return value.slice(0, limit) || null;
}

function providerCredits(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1_000_000_000
    ? value
    : null;
}

function providerOperation(value: string | undefined): string | undefined {
  return value && /^[a-z][a-z0-9_]{0,63}$/.test(value) ? value : undefined;
}

function rowFor(attempt: EdgeAiUsageAttempt): Record<string, unknown> {
  const operation = providerOperation(attempt.metadata?.providerOperation);
  return {
    event_key: attempt.eventKey,
    user_id: attempt.context.actorUserId,
    project_id: bounded(attempt.context.projectId, 256),
    feature: bounded(attempt.context.feature, 100),
    operation: bounded(attempt.context.operation, 100),
    request_kind: attempt.requestKind,
    provider: attempt.provider,
    model: null,
    correlation_id: bounded(attempt.context.correlationId, 256),
    job_id: bounded(attempt.context.jobId, 256),
    artifact_id: bounded(attempt.context.artifactId, 256),
    attempt: Math.max(1, Math.floor(attempt.attempt)),
    provider_request_id: bounded(attempt.providerRequestId, 256),
    outcome: attempt.outcome,
    usage_status: "unknown",
    input_tokens: null,
    output_tokens: null,
    total_tokens: null,
    provider_credits: providerCredits(attempt.providerCredits),
    pricing_rule_version: null,
    started_at: attempt.startedAt,
    finished_at: attempt.finishedAt,
    metadata: operation ? { providerOperation: operation } : {},
  };
}

function persistenceErrorCode(error: unknown): string {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code.slice(0, 64)
    : "unknown";
}

export async function recordEdgeAiUsage(serviceClient: ServiceUsageClient, attempt: EdgeAiUsageAttempt): Promise<void> {
  try {
    const { error } = await serviceClient.from("ai_usage_events").upsert(rowFor(attempt), {
      onConflict: "event_key",
      ignoreDuplicates: true,
    });
    if (error) {
      console.error("ai_usage_ledger_write_failed", {
        eventKey: attempt.eventKey,
        provider: attempt.provider,
        feature: attempt.context.feature.slice(0, 100),
        operation: attempt.context.operation.slice(0, 100),
        persistenceErrorCode: persistenceErrorCode(error),
      });
    }
  } catch (error) {
    console.error("ai_usage_ledger_write_failed", {
      eventKey: attempt.eventKey,
      provider: attempt.provider,
      feature: attempt.context.feature.slice(0, 100),
      operation: attempt.context.operation.slice(0, 100),
      persistenceErrorCode: persistenceErrorCode(error),
    });
  }
}
