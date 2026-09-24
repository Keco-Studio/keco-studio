import {
  agentRuntimeScopeKey,
  bindAgentChatRuntimeToConversation,
  createAgentChatRuntime,
  getScopedAgentRuntime,
  resetAgentChatRuntimeStoreForTests,
  selectScopedAgentRuntime,
  updateAgentChatRuntime,
} from '@/components/agent/agentChatRuntimeStore';

beforeEach(resetAgentChatRuntimeStoreForTests);

describe('workspace scoped runtime', () => {
  it('separates account drafts by workspace and project drafts by project', () => {
    const projects = { userId: 'user-1', workspace: 'projects' as const };
    const map = { userId: 'user-1', workspace: 'create-map' as const };
    const firstProject = { userId: 'user-1', workspace: 'studio' as const, projectId: 'a' };
    const secondProject = { ...firstProject, projectId: 'b' };

    expect(agentRuntimeScopeKey(projects)).toBe('draft:user-1:projects:account');
    expect(agentRuntimeScopeKey(map)).toBe('draft:user-1:create-map:account');
    expect(agentRuntimeScopeKey(firstProject)).toBe('draft:user-1:studio:a');
    expect(agentRuntimeScopeKey(secondProject)).toBe('draft:user-1:studio:b');

    const first = createAgentChatRuntime(firstProject);
    const second = createAgentChatRuntime(secondProject);
    selectScopedAgentRuntime(firstProject, first.key);
    selectScopedAgentRuntime(secondProject, second.key);
    updateAgentChatRuntime(first.key, { items: [{ id: 'one', role: 'user', text: 'A' }] });
    expect(getScopedAgentRuntime(secondProject)?.items).toEqual([]);
  });

  it('keeps a bound conversation in its original scope', () => {
    const origin = { userId: 'user-1', workspace: 'studio' as const, projectId: 'a' };
    const other = { userId: 'user-1', workspace: 'script' as const, projectId: 'a' };
    const draft = createAgentChatRuntime(origin);
    selectScopedAgentRuntime(origin, draft.key);
    const bound = bindAgentChatRuntimeToConversation(draft.key, 'conversation-1');

    expect(bound).toMatchObject({ workspace: 'studio', projectId: 'a' });
    expect(getScopedAgentRuntime(origin)?.key).toBe(bound.key);
    expect(selectScopedAgentRuntime(other, bound.key)).toBeUndefined();
    expect(getScopedAgentRuntime(other)).toBeUndefined();
  });
});
