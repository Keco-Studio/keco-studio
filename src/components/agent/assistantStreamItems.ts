import type { ChatItem } from './types';

export interface AssistantDeltaOptions {
  newId: string;
  kind: 'reasoning' | 'text';
  delta: string;
  now: number;
  segmentStart: boolean;
  moveToEnd?: boolean;
}

export function applyAssistantDelta(
  items: ChatItem[],
  assistantId: string | null,
  options: AssistantDeltaOptions
): { items: ChatItem[]; assistantId: string | null; consumedSegmentStart: boolean } {
  const meaningful = options.delta.trim().length > 0;
  if ((!assistantId || options.segmentStart) && !meaningful) {
    return { items, assistantId, consumedSegmentStart: false };
  }

  const id = assistantId ?? options.newId;
  const existing = items.find((item) => item.id === id);
  const next: ChatItem = existing ? { ...existing } : { id, role: 'assistant' };

  if (options.kind === 'reasoning') {
    const prior = next.reasoning ?? '';
    const separator = options.segmentStart && prior.trim() ? '\n\n' : '';
    next.reasoning = `${prior}${separator}${options.delta}`;
    next.reasoningStartedAt ??= options.now;
  } else {
    const prior = next.text ?? '';
    const separator = options.segmentStart && prior.trim() ? '\n\n' : '';
    next.text = `${prior}${separator}${options.delta}`;
    if (next.reasoning?.trim() && !next.reasoningEndedAt) {
      next.reasoningEndedAt = options.now;
    }
  }

  const withoutCurrent = items.filter((item) => item.id !== id);
  const updatedItems = options.moveToEnd || !existing
    ? [...withoutCurrent, next]
    : items.map((item) => item.id === id ? next : item);

  return {
    items: updatedItems,
    assistantId: id,
    consumedSegmentStart: meaningful,
  };
}

export function finalizeAssistantItem(
  items: ChatItem[],
  assistantId: string | null,
  now: number
): ChatItem[] {
  if (!assistantId) return items;

  return items.flatMap((item) => {
    if (item.id !== assistantId) return [item];
    if (!item.text?.trim() && !item.reasoning?.trim()) return [];
    if (!item.reasoning?.trim() || item.reasoningEndedAt) return [item];
    return [{ ...item, reasoningEndedAt: now }];
  });
}
