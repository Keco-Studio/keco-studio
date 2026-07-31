/**
 * Helpers for rendering assistant reasoning duration labels.
 */

export function formatReasoningSeconds(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rem = seconds % 60;
  return rem > 0 ? `${minutes}m ${rem}s` : `${minutes}m`;
}

export function reasoningDurationMs(
  startedAt?: number,
  endedAt?: number,
  now = Date.now()
): number | undefined {
  if (!startedAt) return undefined;
  const end = endedAt ?? now;
  return Math.max(0, end - startedAt);
}

export function reasoningLabel(
  startedAt: number | undefined,
  endedAt: number | undefined,
  isThinking: boolean,
  now = Date.now()
): string {
  if (!startedAt) return 'Deep thinking';
  const ms = reasoningDurationMs(startedAt, endedAt, now);
  if (ms === undefined) return 'Deep thinking';
  const duration = formatReasoningSeconds(ms);
  return isThinking ? `Thinking (${duration})` : `Thought for ${duration}`;
}

export function summarizeReasoning(reasoning: string, maxLength = 64): string {
  const cleaned = reasoning
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*(?:[-+*]|\d+[.)]|>)+\s*/gm, '')
    .replace(/[*_~#|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned.replace(/[\s.。!！?？:：;；-]/g, '')) return '';

  const sentences = cleaned.match(/[^。！？.!?]+[。！？.!?]?/g) ?? [cleaned];
  const summary = sentences.at(-1)?.trim().replace(/[。！？.!?]+$/, '') ?? '';
  return summary.length <= maxLength ? summary : `${summary.slice(0, maxLength)}…`;
}

export function reasoningDurationLabel(
  startedAt?: number,
  endedAt?: number,
  now = Date.now()
): string {
  const ms = reasoningDurationMs(startedAt, endedAt, now);
  return ms === undefined ? '' : formatReasoningSeconds(ms);
}
