'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useSupabase } from '@/lib/SupabaseContext';
import { getActiveSectionName } from '@/lib/agent/page-context';
import { invalidateLibraryAssetsData, invalidateLibraryData } from '@/lib/queryInvalidation';
import { queryKeys } from '@/lib/utils/queryKeys';
import { notifyDocumentDerivedLibraryCreated } from '@/lib/documents/documentDerivedLibraryEvents';
import { fetchDocumentExportSource } from '@/lib/documents/startDocumentExport';
import { runDocumentDerivedImport } from '@/lib/documents/runDocumentDerivedImport';
import { defaultDerivedLibraryName } from '@/lib/documents/documentDerivedImportProgress';
import type { DocumentExportType } from '@/lib/services/documentDerivedLibraryService';
import {
  clearLastConversation,
  setLastConversation,
  getAutoExecutePreference,
  setAutoExecutePreference,
} from './agentChatStorage';
import { mapHistoryMessagesToChatItems } from './historyMessageMapper';
import { deriveUserDisplay } from './userMessageDisplay';
import {
  applyAssistantDelta,
  finalizeAssistantItem,
  promoteAssistantTextToReasoning,
} from './assistantStreamItems';
import { peekDesignHandoff } from '@/lib/design-upload-handoff';
import type { StreamActivity } from './streamActivity';
import type { AgentInvalidation, ChatItem, SendContext, SendOptions } from './types';
import type { ConversationScope } from '@/lib/agent/types';
import {
  bindAgentChatRuntimeToConversation,
  createAgentChatRuntime,
  getAgentChatRuntime,
  getConversationAgentRuntime,
  getProjectAgentRuntime,
  selectProjectAgentRuntime,
  subscribeAgentChatRuntime,
  updateAgentChatRuntime,
  type AgentChatRuntime,
} from './agentChatRuntimeStore';

let idCounter = 0;
const nextId = () => `item_${Date.now()}_${idCounter++}`;

function isAbortLikeError(error: unknown): boolean {
  if (!error) return false;
  if (error instanceof DOMException && error.name === 'AbortError') return true;
  if (error instanceof Error && error.name === 'AbortError') return true;
  // Aborted body reads can reject with a bare Event in some browsers.
  if (typeof Event !== 'undefined' && error instanceof Event) {
    return error.type === 'abort' || error.type === 'error';
  }
  return false;
}

type PendingAutoGenerateConfirm = {
  actionId: string;
  documentId: string;
  exportType: DocumentExportType;
};

interface ParsedSSE {
  type: string;
  [key: string]: unknown;
}

export function parseAgentInvalidations(event: ParsedSSE): AgentInvalidation[] {
  if (Array.isArray(event.invalidations)) {
    return event.invalidations as AgentInvalidation[];
  }
  if (!Array.isArray(event.paths)) return [];
  return event.paths
    .filter((path): path is string => typeof path === 'string')
    .map((id) => ({ type: 'library' as const, id }));
}

export async function invalidateAgentCaches(
  queryClient: QueryClient,
  router: { refresh: () => void },
  invalidations: AgentInvalidation[]
): Promise<void> {
  for (const invalidation of invalidations) {
    if (invalidation.type === 'library') {
      await invalidateLibraryData(queryClient, {
        projectId: invalidation.projectId,
        libraryId: invalidation.id,
      });
      await invalidateLibraryAssetsData(queryClient, {
        libraryId: invalidation.id,
        includeSchema: true,
        refetchActiveAssets: true,
      });
      if (invalidation.projectId && invalidation.sourceDocumentId) {
        notifyDocumentDerivedLibraryCreated({
          projectId: invalidation.projectId,
          documentId: invalidation.sourceDocumentId,
          libraryId: invalidation.id,
        });
      }
      continue;
    }

    await queryClient.invalidateQueries({
      queryKey: queryKeys.documents(invalidation.projectId),
    });
    if (invalidation.documentId) {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.document(invalidation.documentId),
        exact: true,
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.documentState(invalidation.documentId),
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.documentVersions(invalidation.documentId),
      });
    }
  }

  if (invalidations.length > 0) router.refresh();
}

/**
 * Manages the agent conversation: SSE streaming, message state, confirmation
 * round-trips, and cache invalidation after writes.
 */
export function useAgentChat(ctx: SendContext) {
  const supabase = useSupabase();
  const router = useRouter();
  const queryClient = useQueryClient();

  const initialRuntimeRef = useRef<AgentChatRuntime | null>(null);
  if (!initialRuntimeRef.current) {
    initialRuntimeRef.current = createAgentChatRuntime({
      userId: ctx.userId,
      projectId: ctx.projectId,
    });
  }
  const [runtime, setRuntime] = useState<AgentChatRuntime>(initialRuntimeRef.current);
  const activeRuntimeKeyRef = useRef(runtime.key);
  const projectIdRef = useRef<string | undefined>(undefined);
  const restoreEpochRef = useRef(0);
  /** Auto mode: queue generate_from_document approval without showing a confirm card. */
  const pendingAutoGenerateConfirmRef = useRef<PendingAutoGenerateConfirm | null>(null);
  const streamAbortRef = useRef<AbortController | null>(null);
  const streamReaderRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const userStoppedRef = useRef(false);
  const pendingStopRef = useRef<{
    composerDraft: string;
    userItemId: string;
    assistantItemId: string;
  } | null>(null);
  const confirmRef = useRef<
    | ((
        actionId: string,
        decision: 'approve' | 'reject',
        options?: { generateFromDocument?: PendingAutoGenerateConfirm }
      ) => Promise<void>)
    | null
  >(null);

  const syncRuntime = useCallback((next: AgentChatRuntime) => {
    setRuntime(next);
  }, []);

  const activateRuntime = useCallback(
    (next: AgentChatRuntime) => {
      activeRuntimeKeyRef.current = next.key;
      if (ctx.projectId) selectProjectAgentRuntime(ctx.userId, ctx.projectId, next.key);
      syncRuntime(next);
    },
    [ctx.userId, ctx.projectId, syncRuntime]
  );

  useEffect(
    () =>
      subscribeAgentChatRuntime((key) => {
        if (key !== activeRuntimeKeyRef.current) return;
        const next = getAgentChatRuntime(key);
        if (next) syncRuntime(next);
      }),
    [syncRuntime]
  );

  const appendItem = useCallback((runtimeKey: string, item: ChatItem) => {
    updateAgentChatRuntime(runtimeKey, (current) => ({ items: [...current.items, item] }));
  }, []);

  const updateItem = useCallback(
    (runtimeKey: string, id: string, patch: Partial<ChatItem>) => {
      updateAgentChatRuntime(runtimeKey, (current) => ({
        items: current.items.map((item) =>
          item.id === id ? { ...item, ...patch } : item
        ),
      }));
    },
    []
  );

  const invalidateCaches = useCallback(
    async (invalidations: AgentInvalidation[]) => {
      await invalidateAgentCaches(queryClient, router, invalidations);
    },
    [queryClient, router]
  );

  const getToken = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token;
  }, [supabase]);

  const fetchConversationMeta = useCallback(
    async (
      id: string,
      fallbackAutoExecute: boolean
    ): Promise<{ autoExecute: boolean; scope?: ConversationScope }> => {
      try {
        const token = await getToken();
        const res = await fetch(`/api/agent-chat/conversations/${id}/meta`, {
          credentials: 'include',
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        if (!res.ok) return { autoExecute: fallbackAutoExecute };
        const { meta } = (await res.json()) as {
          meta?: { autoExecute?: boolean; scope?: ConversationScope };
        };
        return { autoExecute: meta?.autoExecute === true, scope: meta?.scope };
      } catch {
        return { autoExecute: fallbackAutoExecute };
      }
    },
    [getToken]
  );

  const applyAutoExecute = useCallback(
    (runtimeKey: string, value: boolean) => {
      updateAgentChatRuntime(runtimeKey, { autoExecute: value });
      if (ctx.userId) {
        setAutoExecutePreference(ctx.userId, value);
      }
    },
    [ctx.userId]
  );

  /**
   * Consume an SSE stream from a Response, mutating chat state as events arrive.
   */
  const beginStreamActivity = useCallback((runtimeKey: string, activity: StreamActivity = 'connecting') => {
    updateAgentChatRuntime(runtimeKey, {
      streamActivity: activity,
      streamStartedAt: Date.now(),
    });
  }, []);

  const consumeStream = useCallback(
    async (
      response: Response,
      initialRuntimeKey: string,
      origin: { userId?: string; projectId: string },
      onBound: (key: string) => void,
      options?: { initialAssistantId?: string | null }
    ) => {
      let runtimeKey = initialRuntimeKey;
      beginStreamActivity(runtimeKey, 'connecting');

      const convHeader = response.headers.get('X-Conversation-Id');
      if (convHeader) {
        const bound = bindAgentChatRuntimeToConversation(runtimeKey, convHeader);
        runtimeKey = bound.key;
        onBound(runtimeKey);
        if (activeRuntimeKeyRef.current === initialRuntimeKey) {
          activeRuntimeKeyRef.current = runtimeKey;
          syncRuntime(bound);
        }
        const selectedForOrigin = getProjectAgentRuntime(origin.userId, origin.projectId);
        if (
          origin.userId &&
          origin.projectId &&
          selectedForOrigin?.key === runtimeKey
        ) {
          setLastConversation(origin.userId, origin.projectId, convHeader);
        }
      }

      const reader = response.body?.getReader();
      if (!reader) return;
      streamReaderRef.current = reader;
      const decoder = new TextDecoder();
      let buffer = '';

      let assistantId: string | null = options?.initialAssistantId ?? null;
      let toolCallId: string | null = null;
      let receivedDone = false;
      let reasoningSegmentStart = true;
      let textSegmentStart = true;
      let toolActivitySinceText = false;

      const handleEvent = (event: ParsedSSE) => {
        if (userStoppedRef.current) return;
        switch (event.type) {
          case 'reasoning_delta': {
            updateAgentChatRuntime(runtimeKey, { streamActivity: 'thinking' });
            const delta = String(event.content ?? '');
            const now = Date.now();
            const candidateId = assistantId ?? nextId();
            updateAgentChatRuntime(runtimeKey, (current) => {
              const result = applyAssistantDelta(current.items, assistantId, {
                newId: candidateId,
                kind: 'reasoning',
                delta,
                now,
                segmentStart: reasoningSegmentStart,
              });
              assistantId = result.assistantId;
              if (result.consumedSegmentStart) reasoningSegmentStart = false;
              return {
                items: result.items,
                streamingAssistantId: result.assistantId,
              };
            });
            break;
          }
          case 'text_delta': {
            updateAgentChatRuntime(runtimeKey, { streamActivity: 'writing' });
            const delta = String(event.content ?? '');
            const now = Date.now();
            const candidateId = assistantId ?? nextId();
            const moveToEnd = toolActivitySinceText && delta.trim().length > 0;
            updateAgentChatRuntime(runtimeKey, (current) => {
              const result = applyAssistantDelta(current.items, assistantId, {
                newId: candidateId,
                kind: 'text',
                delta,
                now,
                segmentStart: textSegmentStart,
                moveToEnd,
              });
              assistantId = result.assistantId;
              if (result.consumedSegmentStart) {
                textSegmentStart = false;
                toolActivitySinceText = false;
              }
              return {
                items: result.items,
                streamingAssistantId: result.assistantId,
              };
            });
            break;
          }
          case 'tool_call_start': {
            reasoningSegmentStart = true;
            textSegmentStart = true;
            toolActivitySinceText = true;
            updateAgentChatRuntime(runtimeKey, { streamActivity: 'tool' });
            // Flush any pending plan text into reasoning on every tool round
            // (not only the first), so later "I will..." plans do not stick in the reply.
            if (assistantId) {
              const now = Date.now();
              updateAgentChatRuntime(runtimeKey, (current) => ({
                items: promoteAssistantTextToReasoning(current.items, assistantId, now),
              }));
            }
            toolCallId = nextId();
            appendItem(runtimeKey, {
              id: toolCallId,
              role: 'tool',
              toolCall: { tool: String(event.tool ?? ''), args: String(event.args ?? ''), status: 'running' },
            });
            break;
          }
          case 'tool_call_end': {
            updateAgentChatRuntime(runtimeKey, { streamActivity: 'processing' });
            break;
          }
          case 'tool_progress': {
            updateAgentChatRuntime(runtimeKey, { streamActivity: 'tool' });
            const progress = event.progress as { message?: unknown } | undefined;
            const progressMessage = String(progress?.message ?? '').trim();
            if (toolCallId && progressMessage) {
              updateAgentChatRuntime(runtimeKey, (current) => ({
                items: current.items.map((item) =>
                  item.id === toolCallId && item.toolCall
                    ? {
                        ...item,
                        toolCall: { ...item.toolCall, progressMessage },
                      }
                    : item
                ),
              }));
            }
            break;
          }
          case 'tool_result': {
            if (toolCallId) {
              const succeeded = event.success !== false;
              updateItem(runtimeKey, toolCallId, {
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
            const actionId = String(event.actionId ?? '');
            const tool = String(event.tool ?? '');
            const runtimeSnapshot = getAgentChatRuntime(runtimeKey);
            const args = (event.args ?? {}) as {
              documentId?: unknown;
              exportType?: unknown;
            };
            const documentId =
              typeof args.documentId === 'string' ? args.documentId.trim() : '';
            const exportType =
              args.exportType === 'table' || args.exportType === 'script'
                ? args.exportType
                : null;

            // Keep server suspension for client derived-import handoff, but Auto
            // mode must not show/require a confirm card.
            if (
              tool === 'generate_from_document' &&
              runtimeSnapshot?.autoExecute === true &&
              documentId &&
              exportType
            ) {
              pendingAutoGenerateConfirmRef.current = {
                actionId,
                documentId,
                exportType,
              };
              break;
            }

            appendItem(runtimeKey, {
              id: nextId(),
              role: 'confirmation',
              confirmation: {
                actionId,
                tool,
                args: event.args,
                confirmationMode: (event.confirmationMode as ConfirmationModeValue) ?? 'pre_execute',
                preview: event.preview,
              },
            });
            break;
          }
          case 'cache_invalidated': {
            void invalidateCaches(parseAgentInvalidations(event));
            break;
          }
          case 'error': {
            appendItem(runtimeKey, {
              id: nextId(),
              role: 'error',
              error: String(event.message ?? 'Unknown error'),
            });
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
        const now = Date.now();
        updateAgentChatRuntime(runtimeKey, (current) => ({
          items: finalizeAssistantItem(current.items, assistantId, now),
          streamingAssistantId: null,
        }));
      };

      try {
        while (true) {
          if (userStoppedRef.current) break;
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
      } catch (error) {
        if (userStoppedRef.current || isAbortLikeError(error)) {
          return;
        }
        throw error;
      } finally {
        if (streamReaderRef.current === reader) {
          streamReaderRef.current = null;
        }
      }
      if (userStoppedRef.current) {
        // stopStreaming already finalized UI for intentional interrupts.
        return;
      }
      finalizeStreamingAssistant();
      if (!receivedDone) {
        appendItem(runtimeKey, {
          id: nextId(),
          role: 'error',
          error: 'Connection closed before the agent finished. Send a follow-up to continue.',
        });
      }
    },
    [appendItem, updateItem, invalidateCaches, beginStreamActivity, syncRuntime]
  );

  const send = useCallback(
    async (message: string, opts?: SendOptions) => {
      if (!ctx.userId) return;
      const selectedRuntime = getAgentChatRuntime(activeRuntimeKeyRef.current);
      if (
        !selectedRuntime ||
        selectedRuntime.isLoading ||
        selectedRuntime.isStreaming ||
        !message.trim()
      ) return;
      let requestRuntimeKey = selectedRuntime.key;
      const display = deriveUserDisplay(message, opts?.imageUrls, opts?.selectionContext);
      const userItemId = nextId();
      appendItem(requestRuntimeKey, {
        id: userItemId,
        role: 'user',
        text: display.text,
        attachments: display.attachments,
      });
      const assistantPlaceholderId = nextId();
      appendItem(requestRuntimeKey, {
        id: assistantPlaceholderId,
        role: 'assistant',
        text: '',
      });
      userStoppedRef.current = false;
      pendingStopRef.current = {
        composerDraft: opts?.composerDraft ?? display.text ?? message,
        userItemId,
        assistantItemId: assistantPlaceholderId,
      };
      const abortController = new AbortController();
      streamAbortRef.current = abortController;
      updateAgentChatRuntime(requestRuntimeKey, {
        isStreaming: true,
        streamingAssistantId: assistantPlaceholderId,
      });
      beginStreamActivity(requestRuntimeKey, 'connecting');
      try {
        const token = await getToken();
        // A new conversation snapshots its scope from the current navigation, so
        // it sends the full live context. An existing conversation is frozen to
        // its bound scope (server-side), so we send only the message — the live
        // navigation must not re-target it.
        const isNew = !selectedRuntime.conversationId;
        const requestBody = isNew
          ? {
              projectId: ctx.projectId,
              currentDocumentId: ctx.currentDocumentId,
              message,
              imageUrls: opts?.imageUrls,
              selectionContext: opts?.selectionContext,
              documentExport: opts?.documentExport,
              autoExecute: selectedRuntime.autoExecute,
              currentFolderId: ctx.currentFolderId,
              currentFolderName: ctx.currentFolderName,
              currentLibraryId: ctx.currentLibraryId,
              currentLibraryName: ctx.currentLibraryName,
              currentSectionName: ctx.currentSectionName ?? getActiveSectionName(ctx.currentLibraryId),
            }
          : {
              conversationId: selectedRuntime.conversationId,
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
          signal: abortController.signal,
        });
        if (!response.ok) {
          const err = await response.json().catch(() => ({ error: 'Request failed' }));
          updateAgentChatRuntime(requestRuntimeKey, (current) => ({
            items: current.items.filter((item) => item.id !== assistantPlaceholderId),
            streamingAssistantId: null,
          }));
          appendItem(requestRuntimeKey, {
            id: nextId(),
            role: 'error',
            error: err.error || `Request failed (${response.status})`,
          });
          return;
        }
        await consumeStream(
          response,
          requestRuntimeKey,
          { userId: ctx.userId, projectId: ctx.projectId },
          (boundKey) => {
            requestRuntimeKey = boundKey;
          },
          { initialAssistantId: assistantPlaceholderId }
        );
      } catch (e) {
        if (userStoppedRef.current || isAbortLikeError(e)) {
          return;
        }
        updateAgentChatRuntime(requestRuntimeKey, (current) => ({
          items: current.items.filter((item) => item.id !== assistantPlaceholderId),
          streamingAssistantId: null,
        }));
        appendItem(requestRuntimeKey, {
          id: nextId(),
          role: 'error',
          error: (e as Error).message || 'Network error',
        });
      } finally {
        streamAbortRef.current = null;
        pendingStopRef.current = null;
        if (!userStoppedRef.current) {
          updateAgentChatRuntime(requestRuntimeKey, {
            isStreaming: false,
            streamStartedAt: null,
            streamingAssistantId: null,
          });
        }
      }

      const autoGenerate = pendingAutoGenerateConfirmRef.current;
      pendingAutoGenerateConfirmRef.current = null;
      if (autoGenerate && !userStoppedRef.current) {
        void confirmRef.current?.(autoGenerate.actionId, 'approve', {
          generateFromDocument: autoGenerate,
        });
      }
    },
    [appendItem, getToken, ctx, consumeStream, beginStreamActivity]
  );

  const setAutoExecute = useCallback(
    async (value: boolean) => {
      if (!ctx.userId) return;
      const selectedRuntime = getAgentChatRuntime(activeRuntimeKeyRef.current);
      if (!selectedRuntime || selectedRuntime.isLoading || selectedRuntime.isStreaming) return;
      const runtimeKey = selectedRuntime.key;
      const prev = selectedRuntime.autoExecute;
      applyAutoExecute(runtimeKey, value);
      if (!selectedRuntime.conversationId) {
        appendItem(runtimeKey, {
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
        const res = await fetch(`/api/agent-chat/conversations/${selectedRuntime.conversationId}/meta`, {
          method: 'PATCH',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ autoExecute: value }),
        });
        if (!res.ok) {
          applyAutoExecute(runtimeKey, prev);
          const err = await res.json().catch(() => ({ error: 'Failed to update mode' }));
          appendItem(runtimeKey, {
            id: nextId(),
            role: 'error',
            error: err.error || 'Failed to update mode',
          });
          return;
        }
        appendItem(runtimeKey, {
          id: nextId(),
          role: 'assistant',
          text: value
            ? 'Mode: Auto — confirmations disabled for this conversation.'
            : 'Mode: Confirm — write operations will require approval.',
        });
      } catch (e) {
        applyAutoExecute(runtimeKey, prev);
        appendItem(runtimeKey, {
          id: nextId(),
          role: 'error',
          error: (e as Error).message || 'Failed to update mode',
        });
      }
    },
    [ctx.userId, applyAutoExecute, getToken, appendItem]
  );

  const confirm = useCallback(
    async (
      actionId: string,
      decision: 'approve' | 'reject',
      options?: {
        generateFromDocument?: PendingAutoGenerateConfirm;
      }
    ) => {
      if (!ctx.userId) return;
      const selectedRuntime = getAgentChatRuntime(activeRuntimeKeyRef.current);
      if (!selectedRuntime || selectedRuntime.isLoading || selectedRuntime.isStreaming) return;
      let requestRuntimeKey = selectedRuntime.key;
      const pendingConfirmation = selectedRuntime.items.find(
        (it) => it.confirmation?.actionId === actionId
      )?.confirmation;
      const generateArgs = options?.generateFromDocument ?? (
        pendingConfirmation?.tool === 'generate_from_document'
          ? (() => {
              const args = (pendingConfirmation.args ?? {}) as {
                documentId?: string;
                exportType?: DocumentExportType;
              };
              const documentId = typeof args.documentId === 'string' ? args.documentId : '';
              const exportType =
                args.exportType === 'table' || args.exportType === 'script'
                  ? args.exportType
                  : null;
              if (!documentId || !exportType) return null;
              return { actionId, documentId, exportType };
            })()
          : null
      );

      updateAgentChatRuntime(requestRuntimeKey, (current) => ({
        items: current.items.map((it) =>
          it.confirmation?.actionId === actionId
            ? { ...it, confirmation: { ...it.confirmation, resolved: decision === 'approve' ? 'approved' : 'rejected' } }
            : it
        ),
      }));
      updateAgentChatRuntime(requestRuntimeKey, { isStreaming: true });
      beginStreamActivity(requestRuntimeKey, 'connecting');
      userStoppedRef.current = false;
      pendingStopRef.current = null;
      const abortController = new AbortController();
      streamAbortRef.current = abortController;
      try {
        let clientCompletedResult: unknown;
        if (decision === 'approve' && generateArgs) {
          // Same path as Document right-click Generate: /api/import-script (300s),
          // so Story IR is not trapped inside the agent-chat turn deadline.
          beginStreamActivity(requestRuntimeKey, 'processing');
          const token = await getToken();
          if (!token) throw new Error('Please sign in before generating');
          const source = await fetchDocumentExportSource(generateArgs.documentId, token);
          const importResult = await runDocumentDerivedImport({
            source,
            exportType: generateArgs.exportType,
            accessToken: token,
          });
          notifyDocumentDerivedLibraryCreated({
            projectId: source.projectId,
            documentId: source.documentId,
            libraryId: importResult.libraryId,
          });
          await invalidateLibraryData(queryClient, {
            projectId: source.projectId,
            folderId: source.folderId,
            libraryId: importResult.libraryId,
            refetchActiveFoldersLibraries: true,
          });
          clientCompletedResult = {
            libraryId: importResult.libraryId,
            libraryName: defaultDerivedLibraryName(
              source.documentName,
              generateArgs.exportType
            ),
            exportType: generateArgs.exportType,
            sourceDocumentId: source.documentId,
            documentName: source.documentName,
            projectId: source.projectId,
            rowCount: importResult.rowCount,
            fieldCount: importResult.fieldCount,
          };
        }

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
            currentDocumentId: ctx.currentDocumentId,
            currentFolderId: ctx.currentFolderId,
            currentFolderName: ctx.currentFolderName,
            currentLibraryId: ctx.currentLibraryId,
            currentLibraryName: ctx.currentLibraryName,
            currentSectionName: ctx.currentSectionName ?? getActiveSectionName(ctx.currentLibraryId),
            ...(clientCompletedResult !== undefined ? { clientCompletedResult } : {}),
          }),
          signal: abortController.signal,
        });
        if (!response.ok) {
          const err = await response.json().catch(() => ({ error: 'Request failed' }));
          appendItem(requestRuntimeKey, {
            id: nextId(),
            role: 'error',
            error: err.error || `Request failed (${response.status})`,
          });
          return;
        }
        await consumeStream(
          response,
          requestRuntimeKey,
          { userId: ctx.userId, projectId: ctx.projectId },
          (boundKey) => {
            requestRuntimeKey = boundKey;
          }
        );
      } catch (e) {
        if (userStoppedRef.current || isAbortLikeError(e)) {
          return;
        }
        updateAgentChatRuntime(requestRuntimeKey, (current) => ({
          items: current.items.map((it) =>
            it.confirmation?.actionId === actionId
              ? { ...it, confirmation: { ...it.confirmation, resolved: undefined } }
              : it
          ),
        }));
        appendItem(requestRuntimeKey, {
          id: nextId(),
          role: 'error',
          error: (e as Error).message || 'Network error',
        });
      } finally {
        streamAbortRef.current = null;
        if (!userStoppedRef.current) {
          updateAgentChatRuntime(requestRuntimeKey, {
            isStreaming: false,
            streamStartedAt: null,
            streamingAssistantId: null,
          });
        }
      }
    },
    [getToken, ctx, consumeStream, appendItem, beginStreamActivity, queryClient]
  );

  confirmRef.current = confirm;

  const stopStreaming = useCallback((): string | null => {
    const pending = pendingStopRef.current;
    const draft = pending?.composerDraft ?? null;
    userStoppedRef.current = true;
    const reader = streamReaderRef.current;
    streamReaderRef.current = null;
    streamAbortRef.current?.abort();
    streamAbortRef.current = null;
    if (reader) {
      void reader.cancel('stopped-by-user').catch(() => undefined);
    }
    pendingStopRef.current = null;

    const runtimeKey = activeRuntimeKeyRef.current;
    const now = Date.now();
    updateAgentChatRuntime(runtimeKey, (current) => {
      if (!pending) {
        return {
          isStreaming: false,
          streamStartedAt: null,
          streamingAssistantId: null,
        };
      }

      const userIdx = current.items.findIndex((item) => item.id === pending.userItemId);
      const before = userIdx >= 0 ? current.items.slice(0, userIdx) : current.items;
      const after = userIdx >= 0 ? current.items.slice(userIdx + 1) : [];
      const kept = after.filter((item) => {
        if (item.id === pending.assistantItemId || item.role === 'assistant') {
          return Boolean(item.text?.trim() || item.reasoning?.trim());
        }
        if (item.role === 'tool' && item.toolCall?.status === 'running') {
          return false;
        }
        return true;
      });
      const finalized = finalizeAssistantItem(kept, pending.assistantItemId, now);

      return {
        items: [...before, ...finalized],
        isStreaming: false,
        streamStartedAt: null,
        streamingAssistantId: null,
      };
    });

    return draft;
  }, []);

  const resetToEmpty = useCallback(() => {
    const next = createAgentChatRuntime({
      userId: ctx.userId,
      projectId: ctx.projectId,
      autoExecute: ctx.userId ? getAutoExecutePreference(ctx.userId) : false,
    });
    activateRuntime(next);
    return next;
  }, [activateRuntime, ctx.projectId, ctx.userId]);

  const startNewConversation = useCallback(() => {
    restoreEpochRef.current += 1;
    if (!ctx.userId) return;
    resetToEmpty();
    if (ctx.userId && ctx.projectId) {
      clearLastConversation(ctx.userId, ctx.projectId);
    }
  }, [resetToEmpty, ctx.userId, ctx.projectId]);

  const loadConversation = useCallback(
    async (id: string, options?: { persist?: boolean }) => {
      restoreEpochRef.current += 1;
      if (!ctx.userId) return false;
      const existing = getConversationAgentRuntime(ctx.userId, id);
      const target = existing ?? createAgentChatRuntime({
        userId: ctx.userId,
        projectId: ctx.projectId,
        conversationId: id,
      });
      if (existing?.isLoading) {
        activateRuntime(existing);
        return true;
      }
      if (existing?.isStreaming) {
        activateRuntime(existing);
        if (options?.persist !== false && ctx.userId && ctx.projectId) {
          setLastConversation(ctx.userId, ctx.projectId, id);
        }
        return true;
      }
      updateAgentChatRuntime(target.key, { isLoading: true });
      activateRuntime(getAgentChatRuntime(target.key) ?? target);
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
          if (activeRuntimeKeyRef.current === target.key) resetToEmpty();
          return false;
        }
        if (!res.ok) return false;
        const { messages } = (await res.json()) as {
          messages: Array<{ id: string; role: string; content: Record<string, unknown> }>;
        };
        const resolvedMeta = await fetchConversationMeta(id, target.autoExecute);
        updateAgentChatRuntime(target.key, (current) => ({
          ...(!current.isStreaming ? { items: mapHistoryMessagesToChatItems(messages) } : {}),
          autoExecute: resolvedMeta.autoExecute,
          activeScope: resolvedMeta.scope,
        }));
        if (options?.persist !== false && ctx.userId && ctx.projectId) {
          setLastConversation(ctx.userId, ctx.projectId, id);
        }
        return true;
      } catch {
        return false;
      } finally {
        updateAgentChatRuntime(target.key, { isLoading: false });
      }
    },
    [getToken, ctx.userId, ctx.projectId, resetToEmpty, fetchConversationMeta, activateRuntime]
  );

  const restoreProjectConversation = useCallback(async () => {
    const restoreEpoch = ++restoreEpochRef.current;
    if (!ctx.projectId) {
      resetToEmpty();
      return;
    }
    if (!ctx.userId) {
      const anonymousRuntime = getProjectAgentRuntime(undefined, ctx.projectId);
      if (anonymousRuntime) {
        activateRuntime(anonymousRuntime);
      } else {
        resetToEmpty();
      }
      return;
    }
    const selectedRuntime = getProjectAgentRuntime(ctx.userId, ctx.projectId);
    if (selectedRuntime) {
      activateRuntime(selectedRuntime);
      return;
    }
    // A pending design-upload hand-off will drive a fresh conversation; skip the
    // normal restore so it cannot clobber the auto-sent message.
    if (peekDesignHandoff(ctx.projectId)) {
      resetToEmpty();
      return;
    }
    const { getLastConversationMap } = await import('./agentChatStorage');
    if (restoreEpoch !== restoreEpochRef.current) return;
    const map = getLastConversationMap(ctx.userId);
    const savedId = map[ctx.projectId];
    if (savedId) {
      const ok = await loadConversation(savedId, { persist: false });
      if (!ok) return;
    } else {
      if (restoreEpoch !== restoreEpochRef.current) return;
      resetToEmpty();
    }
  }, [ctx.userId, ctx.projectId, loadConversation, resetToEmpty, activateRuntime]);

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
    const selectedRuntime = getAgentChatRuntime(activeRuntimeKeyRef.current);
    if (selectedRuntime && !selectedRuntime.conversationId && !selectedRuntime.isStreaming) {
      updateAgentChatRuntime(selectedRuntime.key, {
        autoExecute: getAutoExecutePreference(ctx.userId),
      });
    }
  }, [ctx.userId]);

  const appendNote = useCallback(
    (text: string) => {
      appendItem(activeRuntimeKeyRef.current, { id: nextId(), role: 'assistant', text });
    },
    [appendItem]
  );

  const runtimeMatchesUser = runtime.userId === ctx.userId;

  return {
    items: runtimeMatchesUser ? runtime.items : [],
    isStreaming: ctx.userId && runtimeMatchesUser ? runtime.isLoading || runtime.isStreaming : true,
    streamActivity: runtime.streamActivity,
    streamStartedAt: runtimeMatchesUser ? runtime.streamStartedAt : null,
    streamingAssistantId: runtimeMatchesUser ? runtime.streamingAssistantId : null,
    conversationId: runtimeMatchesUser ? runtime.conversationId : undefined,
    autoExecute: runtimeMatchesUser ? runtime.autoExecute : false,
    activeScope: runtimeMatchesUser ? runtime.activeScope : undefined,
    send,
    confirm,
    stopStreaming,
    setAutoExecute,
    startNewConversation,
    loadConversation,
    appendNote,
  };
}

type ConfirmationModeValue = 'pre_execute' | 'post_preview' | 'meta';
