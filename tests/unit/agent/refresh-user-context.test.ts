import { refreshLastUserContext } from '../../../src/lib/agent/core';
import type { ChatContentPart, ChatMessage, ToolContext } from '../../../src/lib/agent/types';

const ctx = { currentLibraryName: 'Characters' } as unknown as ToolContext;

describe('refreshLastUserContext', () => {
  it('injects page context into a plain string user message', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'create a row' },
    ];
    refreshLastUserContext(messages, ctx);
    expect(typeof messages[1].content).toBe('string');
    expect(messages[1].content).toContain('[User is viewing:');
    expect(messages[1].content).toContain('create a row');
  });

  it('rewrites only the text part of a multimodal user message and keeps images', () => {
    const parts: ChatContentPart[] = [
      { type: 'text', text: 'configure tables' },
      { type: 'image_url', image_url: { url: 'https://x/a.png' } },
    ];
    const messages: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: parts },
    ];
    refreshLastUserContext(messages, ctx);
    const result = messages[1].content as ChatContentPart[];
    expect(Array.isArray(result)).toBe(true);
    expect(result[0].type).toBe('text');
    expect((result[0] as { text: string }).text).toContain('[User is viewing:');
    expect((result[0] as { text: string }).text).toContain('configure tables');
    expect(result[1]).toEqual({ type: 'image_url', image_url: { url: 'https://x/a.png' } });
  });

  it('does not duplicate the context prefix when refreshed twice', () => {
    const messages: ChatMessage[] = [{ role: 'user', content: 'hi' }];
    refreshLastUserContext(messages, ctx);
    refreshLastUserContext(messages, ctx);
    const text = messages[0].content as string;
    expect(text.match(/\[User is viewing:/g)).toHaveLength(1);
  });
});
