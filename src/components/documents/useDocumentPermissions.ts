'use client';

import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { useAuth } from '@/lib/contexts/AuthContext';
import { useProjectRoleQuery } from '@/lib/hooks/useProjectRoleQuery';

export type DocumentRole = 'admin' | 'editor' | 'viewer';

export type DocumentPermissionState = {
  role: DocumentRole | null;
  isLoading: boolean;
  error: string | null;
  readOnly: boolean;
  userId: string | null;
  accessToken: string | null;
  userName: string | null;
};

export type LoadDocumentPermissionsOptions = {
  projectId: string;
  documentProjectId: string;
  supabase: SupabaseClient;
  fetcher?: typeof fetch;
};

const denied = (error: string): DocumentPermissionState => ({
  role: null,
  isLoading: false,
  error,
  readOnly: true,
  userId: null,
  accessToken: null,
  userName: null,
});

export async function loadDocumentPermissions({
  projectId,
  documentProjectId,
  supabase,
  fetcher = fetch,
}: LoadDocumentPermissionsOptions): Promise<DocumentPermissionState> {
  if (documentProjectId !== projectId) {
    return denied('This document does not belong to this project.');
  }

  try {
    const { data, error } = await supabase.auth.getSession();
    const session = data.session;
    if (error || !session?.user?.id || !session.access_token) {
      return denied('Your session could not be verified.');
    }

    const response = await fetcher(`/api/projects/${projectId}/role`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (!response.ok) {
      return denied('Project permissions could not be loaded.');
    }
    const body = (await response.json()) as { role?: unknown };
    const role = body.role;
    if (role !== 'admin' && role !== 'editor' && role !== 'viewer') {
      return denied('You do not have access to this project.');
    }

    return {
      role,
      isLoading: false,
      error: null,
      readOnly: role === 'viewer',
      userId: session.user.id,
      accessToken: session.access_token,
      userName:
        (typeof session.user.user_metadata?.full_name === 'string' &&
        session.user.user_metadata.full_name.trim()
          ? session.user.user_metadata.full_name.trim()
          : null) ??
        (typeof session.user.user_metadata?.name === 'string' &&
        session.user.user_metadata.name.trim()
          ? session.user.user_metadata.name.trim()
          : null) ??
        session.user.email?.split('@')[0] ??
        'Collaborator',
    };
  } catch {
    return denied('Project permissions could not be loaded.');
  }
}

const loadingState: DocumentPermissionState = {
  role: null,
  isLoading: true,
  error: null,
  readOnly: true,
  userId: null,
  accessToken: null,
  userName: null,
};

export function useDocumentPermissions({
  projectId,
  documentProjectId,
  supabase,
}: {
  projectId: string;
  documentProjectId: string | null;
  supabase: SupabaseClient;
}): DocumentPermissionState {
  const { userProfile, isLoading: authLoading } = useAuth();
  const profileUserId = userProfile?.id ?? null;
  const sessionRequestKey = `${projectId}:${profileUserId ?? ''}`;
  const [sessionState, setSessionState] = useState<{
    requestKey: string;
    loading: boolean;
    userId: string | null;
    accessToken: string | null;
    userName: string | null;
    error: string | null;
  }>({
    requestKey: '',
    loading: true,
    userId: null,
    accessToken: null,
    userName: null,
    error: null,
  });
  const roleUserId =
    profileUserId ??
    (sessionState.requestKey === sessionRequestKey && !sessionState.loading
      ? sessionState.userId
      : null);
  const roleQuery = useProjectRoleQuery(projectId, roleUserId);

  useEffect(() => {
    let active = true;
    setSessionState({
      requestKey: sessionRequestKey,
      loading: true,
      userId: null,
      accessToken: null,
      userName: null,
      error: null,
    });
    void supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      const session = data.session;
      if (error || !session?.user?.id || !session.access_token) {
        setSessionState({
          requestKey: sessionRequestKey,
          loading: false,
          userId: null,
          accessToken: null,
          userName: null,
          error: 'Your session could not be verified.',
        });
        return;
      }
      setSessionState({
        requestKey: sessionRequestKey,
        loading: false,
        userId: session.user.id,
        accessToken: session.access_token,
        userName:
          (typeof session.user.user_metadata?.full_name === 'string' &&
          session.user.user_metadata.full_name.trim()
            ? session.user.user_metadata.full_name.trim()
            : null) ??
          (typeof session.user.user_metadata?.name === 'string' &&
          session.user.user_metadata.name.trim()
            ? session.user.user_metadata.name.trim()
            : null) ??
          session.user.email?.split('@')[0] ??
          'Collaborator',
        error: null,
      });
    }).catch(() => {
      if (!active) return;
      setSessionState({
        requestKey: sessionRequestKey,
        loading: false,
        userId: null,
        accessToken: null,
        userName: null,
        error: 'Your session could not be verified.',
      });
    });
    return () => {
      active = false;
    };
  }, [projectId, sessionRequestKey, supabase]);

  if (documentProjectId && documentProjectId !== projectId) {
    return denied('This document does not belong to this project.');
  }
  if (
    authLoading ||
    sessionState.requestKey !== sessionRequestKey ||
    sessionState.loading ||
    roleQuery.isLoading
  ) {
    return loadingState;
  }
  if (sessionState.error || !sessionState.userId || !sessionState.accessToken) {
    return denied(sessionState.error ?? 'Your session could not be verified.');
  }
  if (roleQuery.isError || !roleQuery.data?.role) {
    return denied('Project permissions could not be loaded.');
  }

  return {
    role: roleQuery.data.role,
    isLoading: false,
    error: null,
    readOnly: roleQuery.data.role === 'viewer',
    userId: sessionState.userId,
    accessToken: sessionState.accessToken,
    userName: sessionState.userName,
  };
}
