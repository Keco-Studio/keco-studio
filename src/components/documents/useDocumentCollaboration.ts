'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  CollaborationViewState,
  DocumentCollaborationRole,
  DocumentCollaborationSession,
} from '@/lib/documents/documentCollaborationSession';
import type { CollaborationStatus } from '@/lib/documents/documentStateTypes';
import { colorForUserId } from '@/lib/documents/cursorColor';
import { broadcastProjectDocumentUpdate } from '@/lib/documents/projectDocumentChannel';
import { registerDocumentFlushHandler } from '@/lib/documents/documentFlushRegistry';

type CollaborationPresentation = {
  label: string;
  readOnly: boolean;
  canBind: boolean;
  canRetry: boolean;
  isLegacyView: boolean;
  tone: 'neutral' | 'live' | 'warning' | 'error';
};

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
  const requestKey = `${projectId}:${documentId}:${userId}:${role}:${generation}`;
  const cursorColor = useMemo(() => colorForUserId(userId), [userId]);
  const [active, setActive] = useState<ActiveSession | null>(null);
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
        nextSession = new DocumentCollaborationSession({
          supabase,
          gateway: documentStateGateway,
          documentId,
          projectId,
          userId,
          accessToken,
          role,
          user: { name: userName, color: cursorColor },
          onCompacted: (compacted) =>
            broadcastProjectDocumentUpdate({
              documentId,
              projectId,
              updatedAt: compacted.updatedAt,
              action: 'save',
            }).then(() => undefined),
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
    requestKey,
    role,
    supabase,
    userId,
    userName,
  ]);

  const session = current?.session ?? null;

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
      retry,
    }),
    [
      current?.view.error,
      currentLoadFailure?.error,
      cursorColor,
      presentation,
      retry,
      session,
      status,
      token,
    ]
  );
}
