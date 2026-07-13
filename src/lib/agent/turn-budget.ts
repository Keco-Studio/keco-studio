import type { ChatMessage, TokenUsage } from './types';

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const AGENT_LLM_MAX_TOKENS = parsePositiveInt(process.env.AGENT_LLM_MAX_TOKENS, 4096);
export const AGENT_TURN_TOKEN_BUDGET = parsePositiveInt(process.env.AGENT_TURN_TOKEN_BUDGET, 120_000);
export const AGENT_TURN_MAX_DURATION_MS = parsePositiveInt(
  process.env.AGENT_TURN_MAX_DURATION_MS,
  120_000
);
export const AGENT_TURN_SAFETY_MARGIN_MS = parsePositiveInt(
  process.env.AGENT_TURN_SAFETY_MARGIN_MS,
  10_000
);
export const AGENT_LARGE_USER_CONTENT_CHARS = parsePositiveInt(
  process.env.AGENT_LARGE_USER_CONTENT_CHARS,
  24_000
);

const COMPACTED_MARKER = '[Large user content compacted]';

export function tokenUsageTotal(usage: TokenUsage | undefined): number {
  if (!usage) return 0;
  if (typeof usage.total_tokens === 'number') return usage.total_tokens;
  return (usage.prompt_tokens ?? 0) + (usage.completion_tokens ?? 0);
}

export function addTokenUsageTotal(current: number, usage: TokenUsage | undefined): number {
  return current + tokenUsageTotal(usage);
}

export function isOverTokenBudget(usedTokens: number, budget: number): boolean {
  return usedTokens >= budget;
}

export function tokenBudgetExceededMessage(usedTokens: number, budget: number): string {
  return `Agent stopped because this turn reached the token budget (${usedTokens}/${budget}). Start a new message with a narrower request to continue.`;
}

export function createTurnDeadline(
  nowMs = Date.now(),
  maxDurationMs = AGENT_TURN_MAX_DURATION_MS,
  safetyMarginMs = AGENT_TURN_SAFETY_MARGIN_MS
): number {
  return nowMs + Math.max(0, maxDurationMs - safetyMarginMs);
}

export function isTurnDeadlineExceeded(
  deadlineMs: number,
  nowMs = Date.now()
): boolean {
  return nowMs >= deadlineMs;
}

export function timeLimitExceededMessage(): string {
  return 'Agent stopped because this turn reached the time limit. Start a new message to continue.';
}

function compactLargeText(text: string, maxChars: number): string {
  if (text.length <= maxChars || text.includes(COMPACTED_MARKER)) return text;

  const budget = Math.max(80, Math.min(maxChars, text.length - 1));
  const header = `${COMPACTED_MARKER}\nOriginal length: ${text.length} chars.\n`;
  const separator = '\n...\n';
  const excerptBudget = Math.max(16, budget - header.length - separator.length);
  const excerptChars = Math.max(8, Math.floor(excerptBudget / 2));
  const head = text.slice(0, excerptChars);
  const tail = text.slice(-excerptChars);

  return `${header}${head}${separator}${tail}`;
}

export function compactLargeUserContentInMessages(
  messages: ChatMessage[],
  maxChars = AGENT_LARGE_USER_CONTENT_CHARS
): ChatMessage[] {
  return messages.map((message) => {
    if (message.role !== 'user') return message;

    if (typeof message.content === 'string') {
      const compacted = compactLargeText(message.content, maxChars);
      return compacted === message.content ? message : { ...message, content: compacted };
    }

    if (Array.isArray(message.content)) {
      let changed = false;
      const content = message.content.map((part) => {
        if (part.type !== 'text') return part;
        const compacted = compactLargeText(part.text, maxChars);
        if (compacted !== part.text) changed = true;
        return compacted === part.text ? part : { ...part, text: compacted };
      });
      return changed ? { ...message, content } : message;
    }

    return message;
  });
}
