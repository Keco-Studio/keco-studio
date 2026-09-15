import { deriveAiUsageBinding, type AiUsageBinding, type AiUsageMetadata } from '@/lib/ai-usage/types';

export function gddUsage(
  parent: AiUsageBinding | undefined,
  operation: string,
  metadata: AiUsageMetadata = {},
): AiUsageBinding | undefined {
  return parent ? deriveAiUsageBinding(parent, { operation, metadata }) : undefined;
}
