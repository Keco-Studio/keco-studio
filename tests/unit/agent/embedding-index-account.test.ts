import type { SupabaseClient } from '@supabase/supabase-js';

const embedTexts = jest.fn();
jest.mock('@/lib/agent/embedding-client', () => ({ embedTexts }));

import { reindexConversationTail } from '@/lib/agent/embedding-index';

describe('account conversation embedding index', () => {
  it('writes chat chunks with a null project ID', async () => {
    embedTexts.mockResolvedValue([[0.1, 0.2]]);
    const messages = [
      { id: 'message-1', role: 'user', content: { content: 'Remember this account conversation detail.' }, created_at: '2026-09-24T00:00:00Z' },
      { id: 'message-2', role: 'assistant', content: { content: 'I will remember that detail.' }, created_at: '2026-09-24T00:01:00Z' },
    ];
    const chunkQuery = {
      eq: jest.fn().mockReturnThis(),
      like: jest.fn().mockResolvedValue({ data: [], error: null }),
      maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
    };
    const upsert = jest.fn().mockResolvedValue({ error: null });
    const from = jest.fn((table: string) => table === 'agent_messages'
      ? {
          select: () => ({
            eq: () => ({
              in: () => ({ order: async () => ({ data: messages, error: null }) }),
            }),
          }),
        }
      : {
          select: () => chunkQuery,
          delete: () => chunkQuery,
          upsert,
        });

    await reindexConversationTail({ from } as unknown as SupabaseClient, {
      conversationId: 'conversation-1', projectId: null, userId: 'user-1',
    });

    expect(embedTexts).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith(
      [expect.objectContaining({
        project_id: null,
        user_id: 'user-1',
        conversation_id: 'conversation-1',
        source_type: 'chat_message',
      })],
      { onConflict: 'source_type,source_id,chunk_index,content_hash' },
    );
  });
});
