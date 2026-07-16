'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useSupabase } from '@/lib/SupabaseContext';
import { getActiveSectionName } from '@/lib/agent/page-context';
import { invalidateLibraryAssetsData } from '@/lib/queryInvalidation';
import {
  clearLastConversation,
  setLastConversation,
  getAutoExecutePreference,
  setAutoExecutePreference,
} from './agentChatStorage';
import { mapHistoryMessagesToChatItems } from './historyMessageMapper';
import { deriveUserDisplay } from './userMessageDisplay';
import { peekDesignHandoff } from '@/lib/design-upload-handoff';
import type { StreamActivity } from './streamActivity';
import type { ChatItem, SendContext, SendOptions } from './types';
import type { ConversationScope } from '@/lib/agent/types';

let idCounter = 0;
const nextId = () => `item_${Date.now()}_${idCounter++}`;

/**
 * True when an error is the result of an intentional AbortController.abort()
 * (e.g. the user switched conversations mid-stream). These must not surface as
 * error bubbles. Browsers throw a DOMException named 'AbortError'; some emit a
 * plain Error with the message "signal is aborted without reason".
 */
const isAbortError = (e: unknown): boolean => {
  if (e instanceof DOMException && e.name === 'AbortError') return true;
  const err = e as { name?: string; message?: string } | null;
  if (err?.name === 'AbortError') return true;
  return typeof err?.message === 'string' && err.message.toLowerCase().includes('aborted');
};

interface ParsedSSE {
  type: string;
  [key: string]: unknown;
}

/**
 * Manages the agent conversation: SSE streaming, message state, confirmation
 * round-trips, and cache invalidation after writes.
 */
export function useAgentChat(ctx: SendContext) {
  const supabase = useSupabase();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [items, setItems] = useState<ChatItem[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamActivity, setStreamActivity] = useState<StreamActivity>('connecting');
  const [streamStartedAt, setStreamStartedAt] = useState<number | null>(null);
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);
  const [autoExecute, setAutoExecuteState] = useState(false);
  // Scope the loaded conversation is frozen to (undefined = new/legacy).
  const [activeScope, setActiveScope] = useState<ConversationScope | undefined>(undefined);
  const conversationIdRef = useRef<string | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);
  const streamingAssistantIdRef = useRef<string | null>(null);
  const [streamingAssistantId, setStreamingAssistantId] = useState<string | null>(null);
  const projectIdRef = useRef(ctx.projectId);

  const persistLastConversation = useCallback(
    (id: string | undefined) => {
      if (!ctx.userId || !ctx.projectId || !id) return;
      setLastConversation(ctx.userId, ctx.projectId, id);
    },
    [ctx.userId, ctx.projectId]
  );

  const setConv = useCallback(
    (id: string | undefined, options?: { persist?: boolean }) => {
      conversationIdRef.current = id;
      setConversationId(id);
      if (id && options?.persist !== false) persistLastConversation(id);
    },
    [persistLastConversation]
  );

  const appendItem = useCallback((item: ChatItem) => {
    setItems((prev) => [...prev, item]);
  }, []);

  const updateItem = useCallback((id: string, patch: Partial<ChatItem>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }, []);

  const invalidateCaches = useCallback(
    async (paths: string[]) => {
      for (const libraryId of paths) {
        await invalidateLibraryAssetsData(queryClient, {
          libraryId,
          includeSchema: true,
          refetchActiveAssets: true,
        });
      }
      router.refresh();
    },
    [queryClient, router]
  );

  const getToken = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token;
  }, [supabase]);

  const fetchConversationMeta = useCallback(
    async (id: string): Promise<{ autoExecute: boolean; scope?: ConversationScope }> => {
      try {
        const token = await getToken();
        const res = await fetch(`/api/agent-chat/conversations/${id}/meta`, {
          credentials: 'include',
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        if (!res.ok) return { autoExecute };
        const { meta } = (await res.json()) as {
          meta?: { autoExecute?: boolean; scope?: ConversationScope };
        };
        return { autoExecute: meta?.autoExecute === true, scope: meta?.scope };
      } catch {
        return { autoExecute };
      }
    },
    [getToken, autoExecute]
  );

  const applyAutoExecute = useCallback(
    (value: boolean) => {
      setAutoExecuteState(value);
      if (ctx.userId) {
        setAutoExecutePreference(ctx.userId, value);
      }
    },
    [ctx.userId]
  );

  /**
   * Consume an SSE stream from a Response, mutating chat state as events arrive.
   */
  const beginStreamActivity = useCallback((activity: StreamActivity = 'connecting') => {
    setStreamActivity(activity);
    setStreamStartedAt(Date.now());
  }, []);

  const consumeStream = useCallback(
    async (response: Response) => {
      beginStreamActivity('connecting');

      const convHeader = response.headers.get('X-Conversation-Id');
      if (convHeader) setConv(convHeader);

      const reader = response.body?.getReader();
      if (!reader) return;
      const decoder = new TextDecoder();
      let buffer = '';

      let assistantId: string | null = null;
      let toolCallId: string | null = null;
      let receivedDone = false;

      const ensureAssistantBubble = () => {
        if (!assistantId) {
          assistantId = nextId();
          streamingAssistantIdRef.current = assistantId;
          setStreamingAssistantId(assistantId);
          appendItem({ id: assistantId, role: 'assistant' });
        }
        return assistantId;
      };

      const handleEvent = (event: ParsedSSE) => {
        switch (event.type) {
          case 'reasoning_delta': {
            setStreamActivity('thinking');
            const delta = String(event.content ?? '');
            const id = ensureAssistantBubble();
            const now = Date.now();
            setItems((prev) =>
              prev.map((it) => {
                if (it.id !== id) return it;
                return {
                  ...it,
                  reasoning: (it.reasoning ?? '') + delta,
                  reasoningStartedAt: it.reasoningStartedAt ?? now,
                };
              })
            );
            break;
          }
          case 'text_delta': {
            setStreamActivity('writing');
            const delta = String(event.content ?? '');
            const id = ensureAssistantBubble();
            const now = Date.now();
            setItems((prev) =>
              prev.map((it) => {
                if (it.id !== id) return it;
                const patch: Partial<ChatItem> = { text: (it.text ?? '') + delta };
                if (it.reasoning && !it.reasoningEndedAt) {
                  patch.reasoningEndedAt = now;
                }
                return { ...it, ...patch };
              })
            );
            break;
          }
          case 'tool_call_start': {
            setStreamActivity('tool');
            assistantId = null;
            streamingAssistantIdRef.current = null;
            setStreamingAssistantId(null);
            toolCallId = nextId();
            appendItem({
              id: toolCallId,
              role: 'tool',
              toolCall: { tool: String(event.tool ?? ''), args: String(event.args ?? ''), status: 'running' },
            });
            break;
          }
          case 'tool_call_end': {
            setStreamActivity('processing');
            break;
          }
          case 'tool_progress': {
            setStreamActivity('tool');
            const progress = event.progress as { message?: unknown } | undefined;
            const progressMessage = String(progress?.message ?? '').trim();
            if (toolCallId && progressMessage) {
              setItems((prev) =>
                prev.map((item) =>
                  item.id === toolCallId && item.toolCall
                    ? {
                        ...item,
                        toolCall: { ...item.toolCall, progressMessage },
                      }
                    : item
                )
              );
            }
            break;
          }
          case 'tool_result': {
            if (toolCallId) {
              const succeeded = event.success !== false;
              updateItem(toolCallId, {
                toolCall: {
                  tool: String(event.tool ?? ''),
                  status: succeeded ? 'success' : 'failure',
                  data: event.data,
                  displayHint: event.displayHint ? String(event.displayHint) : undefined,
                  error: typeof event.error === 'string' ? event.error : undefined,
                },
              });
            }
            break;
          }
          case 'confirmation_request': {
            assistantId = null;
            streamingAssistantIdRef.current = null;
            setStreamingAssistantId(null);
            appendItem({
              id: nextId(),
              role: 'confirmation',
              confirmation: {
                actionId: String(event.actionId ?? ''),
                tool: String(event.tool ?? ''),
                args: event.args,
                confirmationMode: (event.confirmationMode as ConfirmationModeValue) ?? 'pre_execute',
                preview: event.preview,
              },
            });
            break;
          }
          case 'cache_invalidated': {
            const paths = Array.isArray(event.paths) ? (event.paths as string[]) : [];
            void invalidateCaches(paths);
            break;
          }
          case 'error': {
            assistantId = null;
            streamingAssistantIdRef.current = null;
            setStreamingAssistantId(null);
            appendItem({ id: nextId(), role: 'error', error: String(event.message ?? 'Unknown error') });
            break;
          }
          case 'done':
            receivedDone = true;
            break;
          default:
            break;
        }
      };

      const finalizeStreamingAssistant = () => {
        const id = streamingAssistantIdRef.current;
        if (!id) return;
        const now = Date.now();
        setItems((prev) =>
          prev.map((it) => {
            if (it.id !== id || !it.reasoning) return it;
            const patch: Partial<ChatItem> = {};
            if (!it.reasoningStartedAt) patch.reasoningStartedAt = now;
            if (!it.reasoningEndedAt) patch.reasoningEndedAt = now;
            return Object.keys(patch).length ? { ...it, ...patch } : it;
          })
        );
        streamingAssistantIdRef.current = null;
        setStreamingAssistantId(null);
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 2);
          if (!frame.startsWith('data:')) continue;
          const payload = frame.slice('data:'.length).trim();
          try {
            handleEvent(JSON.parse(payload) as ParsedSSE);
          } catch {
            // ignore malformed frame
          }
        }
      }
      finalizeStreamingAssistant();
      if (!receivedDone) {
        appendItem({
          id: nextId(),
          role: 'error',
          error: 'Connection closed before the agent finished. Send a follow-up to continue.',
        });
      }
    },
    [appendItem, updateItem, invalidateCaches, setConv, beginStreamActivity]
  );

  const send = useCallback(
    async (message: string, opts?: SendOptions) => {
      if (isStreaming || !message.trim()) return;
      const display = deriveUserDisplay(message, opts?.imageUrls, opts?.selectionContext);
      appendItem({ id: nextId(), role: 'user', text: display.text, attachments: display.attachments });
      setIsStreaming(true);
      beginStreamActivity('connecting');
      abortRef.current = new AbortController();
      try {
        const token = await getToken();
        // A new conversation snapshots its scope from the current navigation, so
        // it sends the full live context. An existing conversation is frozen to
        // its bound scope (server-side), so we send only the message — the live
        // navigation must not re-target it.
        const isNew = !conversationIdRef.current;
        const requestBody = isNew
          ? {
              projectId: ctx.projectId,
              currentDocumentId: ctx.currentDocumentId,
              message,
              imageUrls: opts?.imageUrls,
              selectionContext: opts?.selectionContext,
              autoExecute,
              currentFolderId: ctx.currentFolderId,
              currentFolderName: ctx.currentFolderName,
              currentLibraryId: ctx.currentLibraryId,
              currentLibraryName: ctx.currentLibraryName,
              currentSectionName: ctx.currentSectionName ?? getActiveSectionName(ctx.currentLibraryId),
            }
          : {
              conversationId: conversationIdRef.current,
              currentDocumentId: ctx.currentDocumentId,
              message,
              imageUrls: opts?.imageUrls,
              selectionContext: opts?.selectionContext,
            };
        const response = await fetch('/api/agent-chat', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(requestBody),
          signal: abortRef.current.signal,
        });
        if (!response.ok) {
          const err = await response.json().catch(() => ({ error: 'Request failed' }));
          appendItem({ id: nextId(), role: 'error', error: err.error || `Request failed (${response.status})` });
          return;
        }
        await consumeStream(response);
      } catch (e) {
        // Intentional abort (conversation switch / new chat) is not a failure.
        if (!isAbortError(e)) {
          appendItem({ id: nextId(), role: 'error', error: (e as Error).message || 'Network error' });
        }
      } finally {
        setIsStreaming(false);
        setStreamStartedAt(null);
      }
    },
    [isStreaming, appendItem, getToken, ctx, consumeStream, beginStreamActivity, autoExecute]
  );

  const setAutoExecute = useCallback(
    async (value: boolean) => {
      if (isStreaming) return;
      const prev = autoExecute;
      applyAutoExecute(value);
      if (!conversationIdRef.current) {
        appendItem({
          id: nextId(),
          role: 'assistant',
          text: value
            ? 'Mode: Auto — confirmations disabled for this conversation.'
            : 'Mode: Confirm — write operations will require approval.',
        });
        return;
      }
      try {
        const token = await getToken();
        const res = await fetch(`/api/agent-chat/conversations/${conversationIdRef.current}/meta`, {
          method: 'PATCH',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ autoExecute: value }),
        });
        if (!res.ok) {
          applyAutoExecute(prev);
          const err = await res.json().catch(() => ({ error: 'Failed to update mode' }));
          appendItem({ id: nextId(), role: 'error', error: err.error || 'Failed to update mode' });
          return;
        }
        appendItem({
          id: nextId(),
          role: 'assistant',
          text: value
            ? 'Mode: Auto — confirmations disabled for this conversation.'
            : 'Mode: Confirm — write operations will require approval.',
        });
      } catch (e) {
        applyAutoExecute(prev);
        appendItem({ id: nextId(), role: 'error', error: (e as Error).message || 'Failed to update mode' });
      }
    },
    [isStreaming, autoExecute, applyAutoExecute, getToken, appendItem]
  );

  const confirm = useCallback(
    async (actionId: string, decision: 'approve' | 'reject') => {
      if (isStreaming) return;
      setItems((prev) =>
        prev.map((it) =>
          it.confirmation?.actionId === actionId
            ? { ...it, confirmation: { ...it.confirmation, resolved: decision === 'approve' ? 'approved' : 'rejected' } }
            : it
        )
      );
      setIsStreaming(true);
      beginStreamActivity('connecting');
      abortRef.current = new AbortController();
      try {
        const token = await getToken();
        const response = await fetch('/api/agent-chat/confirm', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            actionId,
            decision,
            currentFolderId: ctx.currentFolderId,
            currentFolderName: ctx.currentFolderName,
            currentLibraryId: ctx.currentLibraryId,
            currentLibraryName: ctx.currentLibraryName,
            currentSectionName: ctx.currentSectionName ?? getActiveSectionName(ctx.currentLibraryId),
          }),
          signal: abortRef.current.signal,
        });
        if (!response.ok) {
          const err = await response.json().catch(() => ({ error: 'Request failed' }));
          appendItem({ id: nextId(), role: 'error', error: err.error || `Request failed (${response.status})` });
          return;
        }
        await consumeStream(response);
      } catch (e) {
        // Intentional abort (conversation switch / new chat) is not a failure.
        if (!isAbortError(e)) {
          appendItem({ id: nextId(), role: 'error', error: (e as Error).message || 'Network error' });
        }
      } finally {
        setIsStreaming(false);
        setStreamStartedAt(null);
      }
    },
    [isStreaming, getToken, ctx, consumeStream, appendItem, beginStreamActivity]
  );

  const resetToEmpty = useCallback(() => {
    abortRef.current?.abort();
    conversationIdRef.current = undefined;
    setConversationId(undefined);
    setItems([]);
    setActiveScope(undefined);
    setIsStreaming(false);
    setStreamStartedAt(null);
    streamingAssistantIdRef.current = null;
    setStreamingAssistantId(null);
  }, []);

  const startNewConversation = useCallback(() => {
    resetToEmpty();
    // Anonymous users must default to manual confirm too — never hardcode auto.
    setAutoExecuteState(ctx.userId ? getAutoExecutePreference(ctx.userId) : false);
    if (ctx.userId && ctx.projectId) {
      clearLastConversation(ctx.userId, ctx.projectId);
    }
  }, [resetToEmpty, ctx.userId, ctx.projectId]);

  const loadConversation = useCallback(
    async (id: string, options?: { persist?: boolean }) => {
      abortRef.current?.abort();
      setConv(id, { persist: options?.persist });
      setItems([]);
      try {
        const token = await getToken();
        const res = await fetch(`/api/agent-chat/conversations/${id}/messages?limit=200`, {
          credentials: 'include',
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        if (res.status === 404) {
          if (ctx.userId && ctx.projectId) {
            clearLastConversation(ctx.userId, ctx.projectId);
          }
          resetToEmpty();
          return false;
        }
        if (!res.ok) return false;
        const { messages } = (await res.json()) as {
          messages: Array<{ id: string; role: string; content: Record<string, unknown> }>;
        };
        setItems(mapHistoryMessagesToChatItems(messages));
        const resolvedMeta = await fetchConversationMeta(id);
        setAutoExecuteState(resolvedMeta.autoExecute);
        setActiveScope(resolvedMeta.scope);
        if (options?.persist !== false && ctx.userId && ctx.projectId) {
          setLastConversation(ctx.userId, ctx.projectId, id);
        }
        return true;
      } catch {
        return false;
      }
    },
    [getToken, setConv, ctx.userId, ctx.projectId, resetToEmpty, fetchConversationMeta]
  );

  const restoreProjectConversation = useCallback(async () => {
    if (!ctx.userId || !ctx.projectId) {
      resetToEmpty();
      return;
    }
    // A pending design-upload hand-off will drive a fresh conversation; skip the
    // normal restore so it cannot clobber the auto-sent message.
    if (peekDesignHandoff(ctx.projectId)) {
      resetToEmpty();
      return;
    }
    const { getLastConversationMap } = await import('./agentChatStorage');
    const map = getLastConversationMap(ctx.userId);
    const savedId = map[ctx.projectId];
    if (savedId) {
      const ok = await loadConversation(savedId, { persist: false });
      if (!ok) return;
    } else {
      resetToEmpty();
    }
  }, [ctx.userId, ctx.projectId, loadConversation, resetToEmpty]);

  useEffect(() => {
    if (projectIdRef.current === ctx.projectId) return;
    projectIdRef.current = ctx.projectId;
    void restoreProjectConversation();
  }, [ctx.projectId, restoreProjectConversation]);

  useEffect(() => {
    if (!ctx.userId || !ctx.projectId) return;
    void restoreProjectConversation();
    // Only run when user becomes available on initial mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.userId]);

  useEffect(() => {
    if (!ctx.userId) return;
    setAutoExecuteState(getAutoExecutePreference(ctx.userId));
  }, [ctx.userId]);

  const appendNote = useCallback(
    (text: string) => {
      appendItem({ id: nextId(), role: 'assistant', text });
    },
    [appendItem]
  );

  return {
    items,
    isStreaming,
    streamActivity,
    streamStartedAt,
    streamingAssistantId,
    conversationId,
    autoExecute,
    activeScope,
    send,
    confirm,
    setAutoExecute,
    startNewConversation,
    loadConversation,
    appendNote,
  };
}

type ConfirmationModeValue = 'pre_execute' | 'post_preview' | 'meta';
