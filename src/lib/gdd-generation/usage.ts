import { deriveAiUsageBinding, type AiProvider, type AiUsageBinding, type AiUsageMetadata } from '@/lib/ai-usage/types';

export function gddLlmProvider(): AiProvider {
  const provider = process.env.GDD_GENERATION_LLM_PROVIDER ?? 'deepseek';
  return provider === 'deepseek' || provider === 'minimax' || provider === 'openai'
    || provider === 'pixellab' || provider === 'unknown'
    ? provider
    : 'unknown';
}

export function gddUsage(
  parent: AiUsageBinding | undefined,
  operation: string,
  metadata: AiUsageMetadata = {},
): AiUsageBinding | undefined {
  return parent ? deriveAiUsageBinding(parent, { operation, metadata }) : undefined;
}

export function gddFeatureUsage(
  parent: AiUsageBinding | undefined,
  feature: string,
  operation: string,
  metadata: AiUsageMetadata = {},
): AiUsageBinding | undefined {
  const binding = gddUsage(parent, operation, metadata);
  return binding ? { ...binding, context: { ...binding.context, feature } } : undefined;
}
