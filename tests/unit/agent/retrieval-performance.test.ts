import type { SupabaseClient } from '@supabase/supabase-js';
import type { ToolContext } from '@/lib/agent/types';
import { SCOPE_QUOTAS, type RetrievalScope } from '@/lib/agent/embedding-config';
import { retrievalScopesForContext } from '@/lib/agent/core';
import { retrieveRelevantChunks } from '@/lib/agent/embedding-retrieval';

const projectScopes = Object.keys(SCOPE_QUOTAS) as RetrievalScope[];

function context(projectId?: string): ToolContext {
  return {
    projectId,
    userId: 'user-1',
    conversationId: 'conversation-1',
    workspace: projectId ? 'studio' : 'projects',
    supabase: {} as SupabaseClient,
  };
}

describe('retrieval scope selection', () => {
  it('selects every configured project scope and only the current account conversation', () => {
    expect(retrievalScopesForContext(context('project-1'))).toEqual(projectScopes);
    expect(retrievalScopesForContext(context())).toEqual(['chat_same_conversation']);
    expect(retrievalScopesForContext(context(''))).toEqual(['chat_same_conversation']);
  });
});

describe('retrieval RPC fan-out', () => {
  it('starts every positive-quota scope before any RPC resolves', async () => {
    const scopeQuotas = Object.fromEntries(projectScopes.map((scope) => [scope, 1])) as Record<RetrievalScope, number>;
    const resolveByScope = new Map<RetrievalScope, (value: { data: []; error: null }) => void>();
    const rpc = jest.fn((_name: string, args: { p_scope: RetrievalScope; p_project_id: string; p_match_count: number }) =>
      new Promise<{ data: []; error: null }>((resolve) => resolveByScope.set(args.p_scope, resolve))
    );
    const retrieval = retrieveRelevantChunks({
      supabase: { rpc } as unknown as SupabaseClient,
      queryEmbedding: [0.1, 0.2],
      projectId: 'project-1',
      userId: 'user-1',
      conversationId: 'conversation-1',
      scopes: projectScopes,
      scopeQuotas,
    });

    const selectedScopes = projectScopes;
    expect(rpc).toHaveBeenCalledTimes(selectedScopes.length);
    expect(rpc.mock.calls.map(([, args]) => args.p_scope)).toEqual(selectedScopes);
    for (const scope of [...selectedScopes].reverse()) {
      resolveByScope.get(scope)?.({ data: [], error: null });
    }
    await expect(retrieval).resolves.toEqual([]);
    for (const [, args] of rpc.mock.calls) {
      expect(args.p_project_id).toBe('project-1');
      expect(args.p_match_count).toBe(2);
    }
  });

  it('sends a null project and never requests project scopes for account context', async () => {
    const rpc = jest.fn(async (_name: string, _args: unknown) => ({ data: [], error: null }));
    await retrieveRelevantChunks({
      supabase: { rpc } as unknown as SupabaseClient,
      queryEmbedding: [0.1, 0.2],
      projectId: undefined,
      userId: 'user-1',
      conversationId: 'conversation-1',
      scopes: projectScopes,
      scopeQuotas: Object.fromEntries(projectScopes.map((scope) => [scope, 1])) as Record<RetrievalScope, number>,
    });

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][1]).toMatchObject({
      p_project_id: null,
      p_scope: 'chat_same_conversation',
      p_conversation_id: 'conversation-1',
      p_user_id: 'user-1',
    });
  });
});
