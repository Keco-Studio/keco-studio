import { describe, expect, it } from '@jest/globals';
import {
  addTokenUsageTotal,
  compactLargeUserContentInMessages,
  isOverTokenBudget,
  tokenUsageTotal,
} from '../../../src/lib/agent/turn-budget';
import type { ChatMessage } from '../../../src/lib/agent/types';

describe('agent turn budget helpers', () => {
  it('calculates token usage from provider totals or prompt/completion fallback', () => {
    expect(tokenUsageTotal({ total_tokens: 42, prompt_tokens: 20, completion_tokens: 22 })).toBe(42);
    expect(tokenUsageTotal({ prompt_tokens: 20, completion_tokens: 22 })).toBe(42);
    expect(addTokenUsageTotal(10, { total_tokens: 5 })).toBe(15);
  });

  it('stops once cumulative usage reaches the configured budget', () => {
    expect(isOverTokenBudget(99, 100)).toBe(false);
    expect(isOverTokenBudget(100, 100)).toBe(true);
    expect(isOverTokenBudget(101, 100)).toBe(true);
  });

  it('compacts large text user messages so the full body is not re-sent', () => {
    const body = `Intro\n${'A'.repeat(250)}`;
    const messages: ChatMessage[] = [
      { role: 'system', content: 'system' },
      { role: 'user', content: body },
      { role: 'assistant', content: 'ok' },
    ];

    const compacted = compactLargeUserContentInMessages(messages, 80);

    expect(compacted[1].content).not.toBe(body);
    expect(String(compacted[1].content)).toContain('Large user content compacted');
    expect(String(compacted[1].content)).toContain('Original length:');
    expect(String(compacted[1].content).length).toBeLessThan(body.length);
  });

  it('compacts only text parts and preserves attached images', () => {
    const messages: ChatMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'B'.repeat(160) },
          { type: 'image_url', image_url: { url: 'https://example.test/image.png' } },
        ],
      },
    ];

    const compacted = compactLargeUserContentInMessages(messages, 50);

    expect(Array.isArray(compacted[0].content)).toBe(true);
    const parts = compacted[0].content as Exclude<ChatMessage['content'], string | null>;
    expect(parts[0]).toMatchObject({ type: 'text' });
    expect(parts[1]).toEqual({ type: 'image_url', image_url: { url: 'https://example.test/image.png' } });
    expect(parts[0].type === 'text' ? parts[0].text : '').toContain('Large user content compacted');
  });
});
