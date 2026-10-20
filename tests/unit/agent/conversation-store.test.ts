import type { SupabaseClient } from '@supabase/supabase-js';
const triggerConversationIndexing = jest.fn();
jest.mock('@/lib/agent/embedding-index', () => ({ triggerConversationIndexing }));
import {
  getOrCreateConversation,
  listAllConversations,
  saveMessage,
} from '../../../src/lib/agent/conversation-store';

const userId = '11111111-1111-4111-8111-111111111111';
const projectId = '22222222-2222-4222-8222-222222222222';

function row(boundProjectId: string | null) {
  return {
    id: 'conversation-1',
    user_id: userId,
    project_id: boundProjectId,
    title: null,
    meta: {},
    created_at: '2026-09-24T00:00:00Z',
    updated_at: '2026-09-24T00:00:00Z',
  };
}

function storeClient(record: ReturnType<typeof row>) {
  const insert = jest.fn(() => ({
    select: () => ({ single: async () => ({ data: record, error: null }) }),
  }));
  const select = jest.fn(() => ({
    eq: () => ({ single: async () => ({ data: record, error: null }) }),
  }));
  const supabase = {
    from: () => ({ insert, select }),
  } as unknown as SupabaseClient;
  return { supabase, insert, select };
}

describe('conversation project binding', () => {
  it('queues an account message for chat indexing with a null project ID', async () => {
    const messageRow = { id: 'message-1', created_at: '2026-09-24T00:00:00Z' };
    const supabase = {
      from: (table: string) => table === 'agent_messages'
        ? { insert: () => ({ select: () => ({ single: async () => ({ data: messageRow, error: null }) }) }) }
        : { update: () => ({ eq: async () => ({ error: null }) }) },
    } as unknown as SupabaseClient;

    await saveMessage(supabase, 'conversation-1', { role: 'user', content: 'Account memory' }, {
      projectId: null, userId,
    });

    expect(triggerConversationIndexing).toHaveBeenCalledWith(supabase, expect.objectContaining({
      conversationId: 'conversation-1', projectId: null, userId,
      role: 'user', messageText: 'Account memory',
    }));
  });
  it('inserts null for a new account conversation', async () => {
    const { supabase, insert } = storeClient(row(null));
    const conversation = await getOrCreateConversation(supabase, { userId });

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      user_id: userId,
      project_id: null,
    }));
    expect(conversation.project_id).toBeNull();
  });

  it('loads an account conversation with omitted or null requested project', async () => {
    const { supabase } = storeClient(row(null));
    await expect(getOrCreateConversation(supabase, {
      conversationId: 'conversation-1', userId,
    })).resolves.toMatchObject({ project_id: null });
    await expect(getOrCreateConversation(supabase, {
      conversationId: 'conversation-1', userId, projectId: null,
    })).resolves.toMatchObject({ project_id: null });
  });

  it('rejects a different requested project for a project-bound conversation', async () => {
    const { supabase } = storeClient(row(projectId));
    await expect(getOrCreateConversation(supabase, {
      conversationId: 'conversation-1', userId, projectId: 'different-project',
    })).rejects.toThrow('Conversation project binding does not match the requested context.');
  });

  it('maps an account history item with a null project ID', async () => {
    const accountRow = { ...row(null), projects: null };
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({ order: async () => ({ data: [accountRow], error: null }) }),
        }),
      }),
    } as unknown as SupabaseClient;

    await expect(listAllConversations(supabase, userId)).resolves.toEqual([
      expect.objectContaining({ projectId: null }),
    ]);
  });
});
