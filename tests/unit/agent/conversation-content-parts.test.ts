import type { SupabaseClient } from '@supabase/supabase-js';
import {
  parseStoredContent,
  loadConversationHistory,
} from '../../../src/lib/agent/conversation-store';
import type { ChatContentPart } from '../../../src/lib/agent/types';

describe('parseStoredContent', () => {
  it('keeps a plain string (backward compatible)', () => {
    expect(parseStoredContent('hello')).toBe('hello');
  });

  it('returns empty string for null/undefined', () => {
    expect(parseStoredContent(null)).toBe('');
    expect(parseStoredContent(undefined)).toBe('');
  });

  it('restores a multimodal content-part array', () => {
    const parts: ChatContentPart[] = [
      { type: 'text', text: 'look' },
      { type: 'image_url', image_url: { url: 'https://x/a.png' } },
    ];
    expect(parseStoredContent(parts)).toEqual(parts);
  });

  it('serializes a non-parts object to JSON (e.g. legacy tool payloads)', () => {
    expect(parseStoredContent({ foo: 'bar' })).toBe('{"foo":"bar"}');
  });
});

function makeSupabase(rows: Array<{ role: string; content: unknown }>): SupabaseClient {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          order: async () => ({ data: rows, error: null }),
        }),
      }),
    }),
  } as unknown as SupabaseClient;
}

describe('loadConversationHistory with content parts', () => {
  it('reconstructs a user message that carries image parts', async () => {
    const parts: ChatContentPart[] = [
      { type: 'text', text: '[Design document] ...' },
      { type: 'image_url', image_url: { url: 'https://x/a.png' } },
    ];
    const supabase = makeSupabase([{ role: 'user', content: { content: parts } }]);
    const history = await loadConversationHistory(supabase, 'conv-1');
    expect(history).toHaveLength(1);
    expect(history[0].role).toBe('user');
    expect(history[0].content).toEqual(parts);
  });

  it('still loads legacy string user messages', async () => {
    const supabase = makeSupabase([{ role: 'user', content: { content: 'plain text' } }]);
    const history = await loadConversationHistory(supabase, 'conv-1');
    expect(history[0].content).toBe('plain text');
  });

  it('preserves reasoning_content on assistant tool-call messages', async () => {
    const supabase = makeSupabase([{
      role: 'assistant',
      content: {
        content: '',
        reasoning_content: 'Inspect the current story graph first.',
        tool_calls: [{
          id: 'call-1',
          type: 'function',
          function: { name: 'read_story_graph', arguments: '{}' },
        }],
      },
    }]);
    const history = await loadConversationHistory(supabase, 'conv-1');
    expect(history[0]).toMatchObject({
      role: 'assistant',
      reasoning_content: 'Inspect the current story graph first.',
    });
  });
});
