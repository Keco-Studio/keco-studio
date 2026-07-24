import type { ConversationScope } from '@/lib/agent/types';
import type { StreamActivity } from './streamActivity';
import type { ChatItem } from './types';

export interface AgentChatRuntime {
  key: string;
  userId?: string;
  projectId: string;
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

type RuntimePatch = Partial<Omit<AgentChatRuntime, 'key' | 'userId' | 'projectId'>>;
type RuntimeListener = (key: string) => void;

const runtimes = new Map<string, AgentChatRuntime>();
const selectedRuntimeByProject = new Map<string, string>();
const listeners = new Set<RuntimeListener>();
let draftCounter = 0;

const ownerKey = (userId?: string) => userId ?? 'anonymous';
const projectSelectionKey = (userId: string | undefined, projectId: string) =>
  `${ownerKey(userId)}:${projectId}`;

export const conversationRuntimeKey = (userId: string | undefined, conversationId: string) =>
  `conversation:${ownerKey(userId)}:${conversationId}`;

function emit(key: string) {
  for (const listener of listeners) listener(key);
}

export function createAgentChatRuntime(input: {
  userId?: string;
  projectId: string;
  conversationId?: string;
  autoExecute?: boolean;
}): AgentChatRuntime {
  const key = input.conversationId
    ? conversationRuntimeKey(input.userId, input.conversationId)
    : `draft:${ownerKey(input.userId)}:${input.projectId}:${draftCounter++}`;
  const existing = runtimes.get(key);
  if (existing) return existing;

  const runtime: AgentChatRuntime = {
    key,
    userId: input.userId,
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

export function selectProjectAgentRuntime(
  userId: string | undefined,
  projectId: string,
  key: string
): AgentChatRuntime | undefined {
  const runtime = runtimes.get(key);
  if (!runtime || runtime.userId !== userId) return undefined;
  selectedRuntimeByProject.set(projectSelectionKey(userId, projectId), key);
  emit(key);
  return runtime;
}

export function getProjectAgentRuntime(
  userId: string | undefined,
  projectId: string
): AgentChatRuntime | undefined {
  const key = selectedRuntimeByProject.get(projectSelectionKey(userId, projectId));
  return key ? runtimes.get(key) : undefined;
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
  for (const [projectId, selectedKey] of selectedRuntimeByProject) {
    if (selectedKey === key) selectedRuntimeByProject.set(projectId, nextKey);
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
  selectedRuntimeByProject.clear();
  listeners.clear();
  draftCounter = 0;
}
