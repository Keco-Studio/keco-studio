export type AiProvider = 'deepseek' | 'minimax' | 'openai' | 'pixellab' | 'unknown';
export type AiRequestKind = 'chat_completion' | 'embedding' | 'provider_generation';
export type AiUsageOutcome = 'succeeded' | 'provider_error' | 'transport_error' | 'aborted';

export type AiUsageContext = {
  actorUserId: string;
  projectId?: string;
  feature: string;
  operation: string;
  correlationId: string;
  jobId?: string;
  artifactId?: string;
};

export type NormalizedTokenUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type AiUsageMetadata = Record<string, string | number | boolean | null>;

export type AiUsageAttempt = {
  eventKey: string;
  context: AiUsageContext;
  requestKind: AiRequestKind;
  provider: AiProvider;
  model: string | null;
  attempt: number;
  providerRequestId?: string;
  outcome: AiUsageOutcome;
  usage: NormalizedTokenUsage | null;
  providerCredits?: number;
  startedAt: string;
  finishedAt: string;
  metadata?: AiUsageMetadata;
};

export type AiUsageRecorder = (attempt: AiUsageAttempt) => Promise<void>;
export type AiUsageBinding = {
  context: AiUsageContext;
  recorder: AiUsageRecorder;
  metadata?: AiUsageMetadata;
};

export type AiUsageBindingOverrides =
  Partial<Pick<AiUsageContext, 'operation' | 'jobId' | 'artifactId'>> & {
    metadata?: AiUsageMetadata;
  };

export function deriveAiUsageBinding(
  parent: AiUsageBinding,
  overrides: AiUsageBindingOverrides,
): AiUsageBinding {
  const { metadata, ...contextOverrides } = overrides;
  return {
    context: { ...parent.context, ...contextOverrides },
    recorder: parent.recorder,
    metadata: metadata ? { ...parent.metadata, ...metadata } : parent.metadata,
  };
}
