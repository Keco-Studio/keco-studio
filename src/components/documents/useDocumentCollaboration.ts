'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import type {
  CollaborationViewState,
  DocumentCollaborationRole,
  DocumentCollaborationSession,
} from '@/lib/documents/documentCollaborationSession';
import type { CollaborationStatus } from '@/lib/documents/documentStateTypes';
import { colorForUserId } from '@/lib/documents/cursorColor';
import { broadcastProjectDocumentUpdate } from '@/lib/documents/projectDocumentChannel';
import { registerDocumentFlushHandler } from '@/lib/documents/documentFlushRegistry';
import { queryKeys } from '@/lib/utils/queryKeys';

const AGENT_PROJECT_DOCUMENT_REINDEX_DEBOUNCE_MS = 5000;
const AGENT_PROJECT_DOCUMENT_REINDEX_ATTEMPTS = 2;

type DocumentReindexRequest = {
  projectId: string;
  documentId: string;
  accessToken: string;
};

type PendingDocumentReindex = Omit<DocumentReindexRequest, 'accessToken'>;

async function readReindexFailureMessage(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: unknown };
    if (typeof payload.error === 'string' && payload.error.trim()) {
      return payload.error.trim();
    }
  } catch {
    // Response body may be empty or non-JSON.
  }
  return `HTTP ${response.status}`;
}

export async function requestDocumentReindex(
  input: DocumentReindexRequest,
  fetcher: typeof fetch = fetch
): Promise<boolean> {
  let lastFailure = 'unknown failure';
  for (let attempt = 1; attempt <= AGENT_PROJECT_DOCUMENT_REINDEX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetcher('/api/agent-chat/reindex/document', {
        method: 'POST',
        keepalive: true,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${input.accessToken}`,
        },
        body: JSON.stringify({
          projectId: input.projectId,
          documentId: input.documentId,
        }),
      });
      if (response.ok) return true;
      lastFailure = await readReindexFailureMessage(response);
      // Provider RPM/TPM limits are transient; retrying immediately usually hits cooldown.
      if (response.status === 429) {
        console.warn('embedding.index.project_document_deferred', {
          projectId: input.projectId,
          documentId: input.documentId,
          error: lastFailure,
        });
        return false;
      }
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error);
    }

    if (attempt < AGENT_PROJECT_DOCUMENT_REINDEX_ATTEMPTS) {
      console.warn('embedding.index.project_document_retry', {
        projectId: input.projectId,
        documentId: input.documentId,
        attempt,
        error: lastFailure,
      });
    }
  }

  console.error('embedding.index.project_document_failed', {
    projectId: input.projectId,
    documentId: input.documentId,
    attempts: AGENT_PROJECT_DOCUMENT_REINDEX_ATTEMPTS,
    error: lastFailure,
  });
  return false;
}

type CollaborationPresentation = {
  label: string;
  readOnly: boolean;
  canBind: boolean;
  canRetry: boolean;
  isLegacyView: boolean;
  tone: 'neutral' | 'live' | 'warning' | 'error';
};

type DocumentCollaborator = {
  id: string;
  name: string;
  color: string;
};

export function getDocumentCollaborators(
  states: ReadonlyMap<number, unknown>,
  localUserId: string
): DocumentCollaborator[] {
  const collaborators = new Map<string, DocumentCollaborator>();

  for (const value of states.values()) {
    if (!value || typeof value !== 'object') continue;
    const awarenessState = value as Record<string, unknown>;
    const awarenessData = awarenessState.awarenessData;
    if (!awarenessData || typeof awarenessData !== 'object') continue;

    const userId = (awarenessData as Record<string, unknown>).userId;
    const name = awarenessState.name;
    const color = awarenessState.color;
    if (
      typeof userId !== 'string' ||
      !userId.trim() ||
      typeof name !== 'string' ||
      !name.trim() ||
      typeof color !== 'string' ||
      !color.trim() ||
      typeof awarenessState.focusing !== 'boolean' ||
      userId === localUserId ||
      collaborators.has(userId)
    ) {
      continue;
    }

    collaborators.set(userId, { id: userId, name, color });
  }

  return Array.from(collaborators.values());
}

export function getDocumentCollaborationPresentation(
  status: CollaborationStatus,
  role: DocumentCollaborationRole
): CollaborationPresentation {
  const viewer = role === 'viewer';
  switch (status) {
    case 'authorizing':
      return state('Authorizing...', true, true);
    case 'connecting':
      return state('Connecting...', true, true);
    case 'hydrating':
      return state('Loading live document...', true, false);
    case 'syncing':
      return state('Syncing...', true, true);
    case 'ready':
      return {
        ...state(viewer ? 'View only - Live' : 'Live', viewer, true),
        tone: 'live',
      };
    case 'legacy-view':
      return {
        ...state('View only - Waiting for live editing', true, false),
        isLegacyView: true,
      };
    case 'degraded':
      return {
        ...state('Connection interrupted; changes are pending', true, true),
        canRetry: true,
        tone: 'warning',
      };
    case 'error':
      return {
        ...state('Document could not sync', true, true),
        canRetry: true,
        tone: 'error',
      };
    case 'closed':
      return state('Collaboration closed', true, false);
    case 'idle':
    default:
      return state('Preparing collaboration...', true, false);
  }
}

function state(
  label: string,
  readOnly: boolean,
  canBind: boolean
): CollaborationPresentation {
  return {
    label,
    readOnly,
    canBind,
    canRetry: false,
    isLegacyView: false,
    tone: 'neutral',
  };
}

export type UseDocumentCollaborationOptions = {
  supabase: SupabaseClient;
  documentId: string;
  projectId: string;
  userId: string;
  accessToken: string;
  role: DocumentCollaborationRole;
  userName: string;
};

type ActiveSession = {
  requestKey: string;
  session: DocumentCollaborationSession;
  view: CollaborationViewState;
};

export function useDocumentCollaboration({
  supabase,
  documentId,
  projectId,
  userId,
  accessToken,
  role,
  userName,
}: UseDocumentCollaborationOptions) {
  const [generation, setGeneration] = useState(0);
  const reindexTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDocumentReindexRef = useRef<PendingDocumentReindex | null>(null);
  const accessTokenRef = useRef(accessToken);
  accessTokenRef.current = accessToken;
  const queryClient = useQueryClient();
  const requestKey = `${projectId}:${documentId}:${userId}:${role}:${generation}`;
  const cursorColor = useMemo(() => colorForUserId(userId), [userId]);
  const [active, setActive] = useState<ActiveSession | null>(null);
  const [awarenessRevision, setAwarenessRevision] = useState(0);
  const [loadFailure, setLoadFailure] = useState<{
    requestKey: string;
    error: string;
  } | null>(null);
  const current = active?.requestKey === requestKey ? active : null;
  const currentLoadFailure =
    loadFailure?.requestKey === requestKey ? loadFailure : null;
  const status = currentLoadFailure ? 'error' : current?.view.status ?? 'idle';
  const presentation = getDocumentCollaborationPresentation(status, role);
  const flushScheduledDocumentReindex = useCallback(() => {
    if (reindexTimerRef.current) {
      clearTimeout(reindexTimerRef.current);
      reindexTimerRef.current = null;
    }
    const pending = pendingDocumentReindexRef.current;
    pendingDocumentReindexRef.current = null;
    if (!pending) return;
    void requestDocumentReindex({
      ...pending,
      accessToken: accessTokenRef.current,
    });
  }, []);
  const scheduleDocumentReindex = useCallback(() => {
    if (role === 'viewer') return;
    if (reindexTimerRef.current) clearTimeout(reindexTimerRef.current);
    pendingDocumentReindexRef.current = { projectId, documentId };
    reindexTimerRef.current = setTimeout(() => {
      flushScheduledDocumentReindex();
    }, AGENT_PROJECT_DOCUMENT_REINDEX_DEBOUNCE_MS);
  }, [documentId, flushScheduledDocumentReindex, projectId, role]);

  useEffect(() => () => {
    flushScheduledDocumentReindex();
  }, [documentId, flushScheduledDocumentReindex, projectId, role]);

  useEffect(() => {
    let mounted = true;
    let nextSession: DocumentCollaborationSession | null = null;
    let unsubscribeView = () => undefined;
    let unsubscribeAuth = () => undefined;

    void Promise.all([
      import('@/lib/documents/documentCollaborationSession'),
      import('@/lib/documents/documentStateGateway'),
    ])
      .then(([{ DocumentCollaborationSession }, { documentStateGateway }]) => {
        if (!mounted) return;
        const onDurableStateChanged = async (
          state: { updatedAt: string }
        ) => {
          scheduleDocumentReindex();
          await queryClient.invalidateQueries({
            queryKey: queryKeys.documentVersions(documentId),
          });
          await broadcastProjectDocumentUpdate({
            documentId,
            projectId,
            updatedAt: state.updatedAt,
            action: 'save',
          });
        };
        nextSession = new DocumentCollaborationSession({
          supabase,
          gateway: documentStateGateway,
          documentId,
          projectId,
          userId,
          accessToken,
          role,
          user: { name: userName, color: cursorColor },
          onCompacted: onDurableStateChanged,
          onStateReplaced: onDurableStateChanged,
        });
        const session = nextSession;
        setActive({
          requestKey,
          session,
          view: { status: session.status, token: session.token, error: null },
        });
        unsubscribeView = session.subscribe((view) => {
          if (!mounted) return;
          setActive((previous) =>
            previous?.session === session
              ? { requestKey, session, view }
              : previous
          );
        });
        const { data } = supabase.auth.onAuthStateChange((_event, authSession) => {
          if (
            authSession?.user.id === userId &&
            authSession.access_token
          ) {
            accessTokenRef.current = authSession.access_token;
            void session
              .updateAccessToken(authSession.access_token)
              .catch(() => undefined);
          }
        });
        unsubscribeAuth = () => data.subscription.unsubscribe();
        void session.connect().catch(() => undefined);
      })
      .catch((error: unknown) => {
        if (!mounted) return;
        setLoadFailure({
          requestKey,
          error:
            error instanceof Error
              ? error.message
              : 'Collaboration code could not be loaded',
        });
      });

    return () => {
      mounted = false;
      unsubscribeView();
      unsubscribeAuth();
      if (nextSession) void nextSession.destroy();
    };
  }, [
    accessToken,
    cursorColor,
    documentId,
    projectId,
    queryClient,
    requestKey,
    role,
    scheduleDocumentReindex,
    supabase,
    userId,
    userName,
  ]);

  const session = current?.session ?? null;

  useEffect(() => {
    if (!session) return;
    const awareness = session.awareness as unknown as {
      on: (event: 'change', listener: () => void) => void;
      off: (event: 'change', listener: () => void) => void;
    };
    const onChange = () => setAwarenessRevision((value) => value + 1);
    awareness.on('change', onChange);
    return () => awareness.off('change', onChange);
  }, [session]);

  const collaborators = useMemo(() => {
    void awarenessRevision;
    if (!session) return [];
    const states = session.awareness.getStates() as ReadonlyMap<number, unknown>;
    return getDocumentCollaborators(states, userId);
  }, [awarenessRevision, session, userId]);

  useEffect(() => {
    if (!session) return;
    return registerDocumentFlushHandler(async () => {
      await session.flush();
      scheduleDocumentReindex();
    });
  }, [scheduleDocumentReindex, session]);

  useEffect(() => {
    if (!session) return;
    const recover = () => {
      void session.recoverNow().catch(() => undefined);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        void session.flush().then(scheduleDocumentReindex).catch(() => undefined);
      } else if (document.visibilityState === 'visible') {
        recover();
      }
    };
    const guardPendingUnload = (event: BeforeUnloadEvent) => {
      if (!session.hasPendingChanges) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('focus', recover);
    window.addEventListener('online', recover);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', guardPendingUnload);
    return () => {
      window.removeEventListener('focus', recover);
      window.removeEventListener('online', recover);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', guardPendingUnload);
    };
  }, [scheduleDocumentReindex, session]);

  const retry = useCallback(async () => {
    if (status === 'error') {
      setGeneration((value) => value + 1);
      return;
    }
    if (!session) return;
    await session.retry();
  }, [session, status]);

  const token = useMemo(
    () => current?.view.token ?? { epoch: 0, revision: 0 },
    [current?.view.token]
  );
  return useMemo(
    () => ({
      ...presentation,
      canBind:
        Boolean(session) && presentation.canBind && session!.canAttachBinding,
      session,
      status,
      token,
      error: currentLoadFailure?.error ?? current?.view.error ?? null,
      cursorColor,
      collaborators,
      retry,
    }),
    [
      current?.view.error,
      currentLoadFailure?.error,
      cursorColor,
      collaborators,
      presentation,
      retry,
      session,
      status,
      token,
    ]
  );
}
