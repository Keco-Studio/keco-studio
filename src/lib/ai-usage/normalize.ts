import type { AiRequestKind, NormalizedTokenUsage } from './types';

const nonNegativeInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0;

export function normalizeTokenUsage(
  value: unknown,
  requestKind: AiRequestKind = 'chat_completion',
): NormalizedTokenUsage | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const input = raw.prompt_tokens ?? raw.input_tokens;
  const reportedOutput = raw.completion_tokens ?? raw.output_tokens;
  const output = requestKind === 'embedding' && reportedOutput === undefined
    ? 0
    : reportedOutput;
  const total = raw.total_tokens;
  if (!nonNegativeInteger(input) || !nonNegativeInteger(output)) return null;
  const resolved = total === undefined ? input + output : total;
  if (!nonNegativeInteger(resolved) || resolved < input + output) return null;
  return { inputTokens: input, outputTokens: output, totalTokens: resolved };
}

export function creditsForTokenTotal(totalTokens: bigint): bigint {
  if (totalTokens < BigInt(0)) throw new RangeError('Token total cannot be negative');
  return (totalTokens + BigInt(2)) / BigInt(3);
}
