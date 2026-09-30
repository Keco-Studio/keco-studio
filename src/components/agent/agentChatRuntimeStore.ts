import type { ConversationScope } from '@/lib/agent/types';
import type { StreamActivity } from './streamActivity';
import type { AgentRuntimeScope, ChatItem } from './types';

export interface AgentChatRuntime {
  key: string;
  userId?: string;
  workspace: AgentRuntimeScope['workspace'];
  projectId?: string;
  conversationId?: string;
  items: ChatItem[];
  isLoading: boolean;
  isStreaming: boolean;
  streamActivity: StreamActivity;
  streamStartedAt: number | null;
  streamingAssistantId: string | null;
  autoExecute: boolean;
  activeScope?: ConversationScope;
}

type RuntimePatch = Partial<Omit<AgentChatRuntime, 'key' | 'userId' | 'workspace' | 'projectId'>>;
type RuntimeListener = (key: string) => void;

const runtimes = new Map<string, AgentChatRuntime>();
const selectedRuntimeByScope = new Map<string, string>();
const listeners = new Set<RuntimeListener>();
let draftCounter = 0;

const ownerKey = (userId?: string) => userId ?? 'anonymous';
export const agentRuntimeScopeKey = (scope: AgentRuntimeScope) =>
  `draft:${ownerKey(scope.userId)}:${scope.workspace}:${scope.projectId ?? 'account'}`;

export const conversationRuntimeKey = (userId: string | undefined, conversationId: string) =>
  `conversation:${ownerKey(userId)}:${conversationId}`;

function emit(key: string) {
  for (const listener of listeners) listener(key);
}

export function createAgentChatRuntime(input: Omit<AgentRuntimeScope, 'workspace'> & {
  workspace?: AgentRuntimeScope['workspace'];
  conversationId?: string;
  autoExecute?: boolean;
}): AgentChatRuntime {
  const workspace = input.workspace ?? 'studio';
  const baseKey = agentRuntimeScopeKey({ ...input, workspace });
  const key = input.conversationId
    ? conversationRuntimeKey(input.userId, input.conversationId)
    : runtimes.has(baseKey) ? `${baseKey}:${draftCounter++}` : baseKey;
  const existing = runtimes.get(key);
  if (existing) return existing;

  const runtime: AgentChatRuntime = {
    key,
    userId: input.userId,
    workspace,
    projectId: input.projectId,
    conversationId: input.conversationId,
    items: [],
    isLoading: false,
    isStreaming: false,
    streamActivity: 'connecting',
    streamStartedAt: null,
    streamingAssistantId: null,
    autoExecute: input.autoExecute ?? false,
  };
  runtimes.set(key, runtime);
  emit(key);
  return runtime;
}

export function getAgentChatRuntime(key: string): AgentChatRuntime | undefined {
  return runtimes.get(key);
}

export function getConversationAgentRuntime(
  userId: string | undefined,
  conversationId: string
): AgentChatRuntime | undefined {
  return runtimes.get(conversationRuntimeKey(userId, conversationId));
}

export function updateAgentChatRuntime(
  key: string,
  patch: RuntimePatch | ((runtime: AgentChatRuntime) => RuntimePatch)
): AgentChatRuntime | undefined {
  const current = runtimes.get(key);
  if (!current) return undefined;
  const resolvedPatch = typeof patch === 'function' ? patch(current) : patch;
  const next = { ...current, ...resolvedPatch };
  runtimes.set(key, next);
  emit(key);
  return next;
}

export function selectScopedAgentRuntime(scope: AgentRuntimeScope, key: string): AgentChatRuntime | undefined {
  const runtime = runtimes.get(key);
  if (!runtime || runtime.userId !== scope.userId || runtime.workspace !== scope.workspace ||
      runtime.projectId !== scope.projectId) return undefined;
  selectedRuntimeByScope.set(agentRuntimeScopeKey(scope), key);
  emit(key);
  return runtime;
}

export function getScopedAgentRuntime(scope: AgentRuntimeScope): AgentChatRuntime | undefined {
  const key = selectedRuntimeByScope.get(agentRuntimeScopeKey(scope));
  return key ? runtimes.get(key) : undefined;
}

export function selectProjectAgentRuntime(userId: string | undefined, projectId: string, key: string) {
  return selectScopedAgentRuntime({ userId, workspace: 'studio', projectId }, key);
}

export function getProjectAgentRuntime(userId: string | undefined, projectId: string) {
  return getScopedAgentRuntime({ userId, workspace: 'studio', projectId });
}

export function bindAgentChatRuntimeToConversation(
  key: string,
  conversationId: string
): AgentChatRuntime {
  const current = runtimes.get(key);
  if (!current) {
    throw new Error(`Agent chat runtime not found: ${key}`);
  }

  const nextKey = conversationRuntimeKey(current.userId, conversationId);
  const existing = runtimes.get(nextKey);
  const next: AgentChatRuntime = existing
    ? {
        ...current,
        ...existing,
        key: nextKey,
        workspace: current.workspace,
        projectId: current.projectId,
        conversationId,
        items: current.items.length > 0 ? current.items : existing.items,
        isStreaming: current.isStreaming || existing.isStreaming,
        streamActivity: current.isStreaming ? current.streamActivity : existing.streamActivity,
        streamStartedAt: current.isStreaming ? current.streamStartedAt : existing.streamStartedAt,
        streamingAssistantId: current.isStreaming
          ? current.streamingAssistantId
          : existing.streamingAssistantId,
      }
    : { ...current, key: nextKey, conversationId };

  runtimes.delete(key);
  runtimes.set(nextKey, next);
  for (const [scopeKey, selectedKey] of selectedRuntimeByScope) {
    if (selectedKey === key) selectedRuntimeByScope.set(scopeKey, nextKey);
  }
  emit(key);
  emit(nextKey);
  return next;
}

export function subscribeAgentChatRuntime(listener: RuntimeListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function resetAgentChatRuntimeStoreForTests(): void {
  runtimes.clear();
  selectedRuntimeByScope.clear();
  listeners.clear();
  draftCounter = 0;
}
