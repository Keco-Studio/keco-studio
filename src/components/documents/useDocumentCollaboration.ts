'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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
      return state('Authorizing...', true, false);
    case 'connecting':
      return state('Connecting...', true, false);
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
    return registerDocumentFlushHandler(() => session.flush());
  }, [session]);

  useEffect(() => {
    if (!session) return;
    const refresh = () => {
      void session.refresh().catch(() => undefined);
    };
    const flushWhenHidden = () => {
      if (document.visibilityState === 'hidden') {
        void session.flush().catch(() => undefined);
      }
    };
    const guardPendingUnload = (event: BeforeUnloadEvent) => {
      if (!session.hasPendingChanges) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', flushWhenHidden);
    window.addEventListener('beforeunload', guardPendingUnload);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', flushWhenHidden);
      window.removeEventListener('beforeunload', guardPendingUnload);
    };
  }, [session]);

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
