import { beforeEach, describe, expect, it } from '@jest/globals';
import {
  bindAgentChatRuntimeToConversation,
  createAgentChatRuntime,
  getAgentChatRuntime,
  getProjectAgentRuntime,
  resetAgentChatRuntimeStoreForTests,
  selectProjectAgentRuntime,
  updateAgentChatRuntime,
} from '../../../src/components/agent/agentChatRuntimeStore';

describe('agent chat runtime store', () => {
  beforeEach(() => {
    resetAgentChatRuntimeStoreForTests();
  });

  it('keeps running state isolated while switching projects', () => {
    const first = createAgentChatRuntime({ userId: 'user-1', projectId: 'project-a', autoExecute: true });
    const second = createAgentChatRuntime({ userId: 'user-1', projectId: 'project-b', autoExecute: false });

    selectProjectAgentRuntime('user-1', 'project-a', first.key);
    selectProjectAgentRuntime('user-1', 'project-b', second.key);
    updateAgentChatRuntime(first.key, {
      isStreaming: true,
      streamActivity: 'tool',
      streamStartedAt: 123,
    });

    expect(getProjectAgentRuntime('user-1', 'project-a')).toMatchObject({
      key: first.key,
      isStreaming: true,
      streamActivity: 'tool',
    });
    expect(getProjectAgentRuntime('user-1', 'project-b')).toMatchObject({
      key: second.key,
      isStreaming: false,
    });
  });

  it('binds a temporary runtime to its persisted conversation without losing state', () => {
    const draft = createAgentChatRuntime({ userId: 'user-1', projectId: 'project-a', autoExecute: true });
    selectProjectAgentRuntime('user-1', 'project-a', draft.key);
    updateAgentChatRuntime(draft.key, {
      isStreaming: true,
      items: [{ id: 'user-1', role: 'user', text: 'Keep working' }],
    });

    const bound = bindAgentChatRuntimeToConversation(draft.key, 'conversation-1');

    expect(getAgentChatRuntime(draft.key)).toBeUndefined();
    expect(bound).toMatchObject({
      conversationId: 'conversation-1',
      isStreaming: true,
      items: [{ id: 'user-1', role: 'user', text: 'Keep working' }],
    });
    expect(getProjectAgentRuntime('user-1', 'project-a')?.key).toBe(bound.key);
  });

  it('does not leak background stream updates into the visible conversation', () => {
    const running = createAgentChatRuntime({ userId: 'user-1', projectId: 'project-a', conversationId: 'running' });
    const visible = createAgentChatRuntime({ userId: 'user-1', projectId: 'project-a', conversationId: 'visible' });
    selectProjectAgentRuntime('user-1', 'project-a', visible.key);

    updateAgentChatRuntime(running.key, {
      items: [{ id: 'assistant-1', role: 'assistant', text: 'Finished in background' }],
      isStreaming: false,
    });

    expect(getAgentChatRuntime(running.key)?.items).toHaveLength(1);
    expect(getProjectAgentRuntime('user-1', 'project-a')).toMatchObject({ key: visible.key, items: [] });
  });

  it('allows a persisted conversation to be selected from another project entry', () => {
    const conversation = createAgentChatRuntime({
      userId: 'user-1',
      projectId: 'project-a',
      conversationId: 'conversation-1',
    });

    selectProjectAgentRuntime('user-1', 'project-b', conversation.key);

    expect(getProjectAgentRuntime('user-1', 'project-b')?.conversationId).toBe('conversation-1');
  });

  it('isolates selected runtimes and conversation keys by user', () => {
    const firstUser = createAgentChatRuntime({
      userId: 'user-1',
      projectId: 'shared-project',
      conversationId: 'conversation-1',
    });
    const secondUser = createAgentChatRuntime({
      userId: 'user-2',
      projectId: 'shared-project',
      conversationId: 'conversation-1',
    });

    selectProjectAgentRuntime('user-1', 'shared-project', firstUser.key);
    selectProjectAgentRuntime('user-2', 'shared-project', secondUser.key);

    expect(firstUser.key).not.toBe(secondUser.key);
    expect(getProjectAgentRuntime('user-1', 'shared-project')?.key).toBe(firstUser.key);
    expect(getProjectAgentRuntime('user-2', 'shared-project')?.key).toBe(secondUser.key);
  });

  it('tracks history loading separately from Agent streaming', () => {
    const runtime = createAgentChatRuntime({ userId: 'user-1', projectId: 'project-a' });

    updateAgentChatRuntime(runtime.key, { isLoading: true });

    expect(getAgentChatRuntime(runtime.key)).toMatchObject({
      isLoading: true,
      isStreaming: false,
    });
  });
});
