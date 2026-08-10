import type { ToolCall } from './types';

export function normalizeToolCallForReplay(call: ToolCall): ToolCall {
  let parsed: unknown;
  try {
    parsed = JSON.parse(call.function.arguments);
  } catch {
    parsed = null;
  }

  if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return call;
  }

  return {
    ...call,
    function: {
      ...call.function,
      arguments: '{}',
    },
  };
}
