import type { SupabaseClient } from '@supabase/supabase-js';
import type { AiUsageBinding } from '@/lib/ai-usage/types';
import type { ToolContext } from '@/lib/agent/types';

const embedQuery = jest.fn();
const semanticSearchChunks = jest.fn();

jest.mock('@/lib/agent/embedding-client', () => ({ embedQuery }));
jest.mock('@/lib/agent/embedding-retrieval', () => ({ semanticSearchChunks }));

import { semanticSearch } from '@/lib/agent/tools/semantic-search';

const usageBinding: AiUsageBinding = {
  context: {
    actorUserId: 'user-1',
    projectId: 'project-1',
    feature: 'agent_chat',
    operation: 'react_iteration',
    correlationId: 'agent_turn:turn-1',
  },
  recorder: async () => undefined,
};

describe('semantic_search usage attribution', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    embedQuery.mockResolvedValue([1, 0, 0]);
    semanticSearchChunks.mockResolvedValue([]);
  });

  it('uses a retrieval_query binding for its embedding request', async () => {
    const ctx = {
      projectId: 'project-1',
      userId: 'user-1',
      conversationId: 'conversation-1',
      userRole: 'editor',
      supabase: {} as SupabaseClient,
      usageBinding,
    } as ToolContext;

    await expect(semanticSearch.execute({ query: 'ancient ruins' }, ctx)).resolves.toMatchObject({
      success: true,
    });

    expect(embedQuery).toHaveBeenCalledWith('ancient ruins', expect.objectContaining({
      context: expect.objectContaining({ operation: 'retrieval_query' }),
    }));
  });

  it('degrades cleanly when the embedding provider is unavailable', async () => {
    embedQuery.mockRejectedValueOnce(new Error('Embedding API error 404: Not Found'));

    const result = await semanticSearch.execute({ query: 'dialogue line' }, {
      projectId: 'project-1',
      userId: 'user-1',
      conversationId: 'conversation-1',
      userRole: 'editor',
      supabase: {} as SupabaseClient,
      usageBinding,
    } as ToolContext);

    expect(result).toMatchObject({
      success: true,
      data: {
        results: [],
        degradationReason: 'embedding_unavailable',
      },
    });
    expect(semanticSearchChunks).not.toHaveBeenCalled();
  });
});
